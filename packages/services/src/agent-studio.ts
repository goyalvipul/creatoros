import { randomUUID } from 'node:crypto';
import { sql, publishDrafts, type Db } from '@creatoros/db';
import { agentConfigSchema, scheduleDue, taskInstructions, workflowStages, type AgentConfig } from './agent-studio-contract';
import { agentTaskInput, agentTaskResult, AGENT_EXECUTE, AGENT_SUBSCRIBE, type AgentTaskInput, type AgentTaskResult } from './agent-task-contract';
import { createAgentTask } from './mcp-agent-tasks';
import { createDraftProject } from './projects';
import { productionPlanInputSchema, submitProductionPlan } from './production-plan';
import { generateLtx, ltxApiWorkflow } from './comfy';
import { runEvent, runPrefs, controlProductionRun, setAutomatedProjectStage } from './production-run';
import { productionReadiness, submitChatGPTQualityReport, finalizeChatGPTProduction } from './production-external';
import { readSocialCover, saveSocialCoverBytes, socialCoverLimit } from './social-cover';
import { openAgentFile } from './agent-file';
import { audit } from './audit';
import { AppError, badRequest, conflict, notFound, type Ctx, type ServiceEnv } from './types';

const rows=<T>(v:unknown)=>(v as {rows:T[]}).rows;
type Definition={id:string;org_id:string;owner_id:string;brand_id:string;name:string;enabled:boolean;revision:number;config:AgentConfig};
type Snapshot={config:AgentConfig;referenceFileIds:string[]};
type Run={id:string;agent_id:string;org_id:string;owner_id:string;brand_id:string;slot:string;revision:number;snapshot:Snapshot;state:string;stage:number;project_id:string|null;production_run_id:string|null;plan_id:string|null;job_id:string|null;file_id:string|null};
type TaskRow={id:string;state:string;result:unknown;error_code:string|null};
const active=['QUEUED','DISPATCHED','DELIVERED','CLAIMED','RUNNING'];
const isVideo=(c:AgentConfig)=>c.workflow==='H3_SHORT'||c.workflow==='LTX_SHORT';
function ownerCtx(db:Db,env:ServiceEnv,r:{org_id:string;owner_id:string}):Ctx {
 return {db,env,orgId:r.org_id,userId:r.owner_id,actor:{type:'system'},now:()=>new Date()};
}
async function localClock(ctx:Ctx){
 const [clock]=rows<{day:string;time:string}>(await ctx.db.execute(sql`select to_char(now() at time zone 'America/Vancouver','YYYY-MM-DD') as day,to_char(now() at time zone 'America/Vancouver','HH24:MI') as time`));
 return clock!;
}
async function lockOrg(ctx:Ctx){await ctx.db.execute(sql`select id from organizations where id=${ctx.orgId} for update`);}
async function isolated(ctx:Ctx,subscriptionId:string){
 const [s]=rows<{ok:boolean}>(await ctx.db.execute(sql`
 select true as ok from mcp_agent_subscriptions s join ai_gateway_connections g on g.org_id=s.org_id
 join organization_memberships m on m.org_id=g.org_id and m.user_id=g.hosted_owner
 join users u on u.id=m.user_id
 where s.id=${subscriptionId} and s.org_id=${ctx.orgId} and s.owner_id=${ctx.userId} and s.revoked_at is null
 and s.expires_at>now() and s.callback_enc is not null and g.enabled and g.mode='hosted' and g.agent_exclusive
 and g.hosted_hash=s.credential_hash and g.hosted_owner=s.owner_id
 and ${AGENT_EXECUTE}=any(g.hosted_scopes) and ${AGENT_SUBSCRIBE}=any(g.hosted_scopes)
 and m.role='OWNER' and m.status='ACTIVE' and u.status='ACTIVE'
 `));
 return !!s?.ok;
}
async function verifyConfig(ctx:Ctx,c:AgentConfig){
 if(!rows(await ctx.db.execute(sql`select id from brands where org_id=${ctx.orgId} and id=${c.brandId} and active and deleted_at is null`)).length)throw notFound('Creator');
 if(!rows(await ctx.db.execute(sql`select id from mcp_agent_subscriptions where id=${c.subscriptionId} and org_id=${ctx.orgId} and owner_id=${ctx.userId}`)).length)throw notFound('Production subscription');
 if(c.projectId&&!rows(await ctx.db.execute(sql`select id from creative_projects where id=${c.projectId} and org_id=${ctx.orgId} and brand_id=${c.brandId} and deleted_at is null and stage in ('DRAFT','IN_PROGRESS')`)).length)throw badRequest('Choose a draft project belonging to this creator.');
 if(c.workerId&&!rows(await ctx.db.execute(sql`select id from gpu_workers where id=${c.workerId} and org_id=${ctx.orgId} and enabled`)).length)throw notFound('GPU worker');
 if(isVideo(c)&&c.projectId)throw badRequest('Video workflows create a fresh draft project per run.');
 if(c.workflow==='LTX_SHORT')await verifyLtxAudio(ctx,c);
}
async function verifyLtxAudio(ctx:Ctx,c:AgentConfig){
 const a=c.ltx;
 if(!a)throw badRequest('Select LTX audio and LoRA.');
 const [audio]=rows<{duration:number|null}>(await ctx.db.execute(sql`
  select nullif(f.tech->>'durationMs','')::float8 as duration from file_instances f
  join asset_file_links l on l.file_instance_id=f.id and l.org_id=f.org_id
  join asset_versions v on v.id=l.asset_version_id and v.org_id=l.org_id
  join logical_assets b on b.id=v.asset_id and b.org_id=v.org_id
  where f.id=${a.audioFileId} and f.org_id=${ctx.orgId} and b.brand_id=${c.brandId} and not b.is_archived
  and f.archived_at is null and f.availability='AVAILABLE' and f.file_type='AUDIO' limit 1`));
 if(!audio?.duration||audio.duration/1000<a.audioStartSec+c.durationSec)throw badRequest('Choose verified creator audio with sufficient measured duration.');
 return a;
}
async function reserveRender(ctx:Ctx,count:number){
 const raw=ctx.env.processEnv.AI_GATEWAY_DAILY_GENERATION_LIMIT;
 const limit=raw&&/^\d+$/.test(raw)?Math.min(100,Number(raw)):2;
 const [quota]=rows<{n:number}>(await ctx.db.execute(sql`
  select (coalesce((select sum(1+coalesce((payload->>'maxRegenerations')::int,0)) from production_plans
    where org_id=${ctx.orgId} and created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver'),0)
   +(select count(*) from generation_jobs where org_id=${ctx.orgId} and provider in ('comfyui-h3','comfyui-ltx')
    and settings->>'productionPlanId' is null and created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver'))::int as n`));
 if((quota?.n??0)+count>limit)throw conflict('Daily native GPU render reservation exhausted.');
}
export async function saveAgentDefinition(ctx:Ctx,raw:AgentConfig,id?:string){
 const c=agentConfigSchema.parse(raw);
 return ctx.db.transaction(async tx=>{
  const scoped={...ctx,db:tx};await lockOrg(scoped);await verifyConfig(scoped,c);
  let saved:Definition|undefined;
  if(id){
   const [old]=rows<Definition>(await tx.execute(sql`select * from agent_definitions where id=${id} and org_id=${ctx.orgId} and owner_id=${ctx.userId} for update`));
   if(!old)throw notFound('Agent');
   if(old.brand_id!==c.brandId)throw badRequest('Creator association is immutable; create a new agent.');
   if(old.enabled)throw conflict('Disable the agent before editing its configuration.');
   [saved]=rows<Definition>(await tx.execute(sql`update agent_definitions set name=${c.name},config=${JSON.stringify(c)}::jsonb,revision=revision+1,updated_at=now() where id=${id} returning *`));
  }else{
   [saved]=rows<Definition>(await tx.execute(sql`insert into agent_definitions(org_id,owner_id,brand_id,name,config) values(${ctx.orgId},${ctx.userId},${c.brandId},${c.name},${JSON.stringify(c)}::jsonb) returning *`));
  }
  await tx.execute(sql`insert into agent_definition_versions(agent_id,revision,config) values(${saved!.id},${saved!.revision},${JSON.stringify(c)}::jsonb)`);
  await audit(scoped,'agent.definition.save',{type:'agent',id:saved!.id},undefined,{revision:saved!.revision});
  return saved!;
 });
}
export async function enableAgentDefinition(ctx:Ctx,id:string,enabled:boolean){
 return ctx.db.transaction(async tx=>{
  const scoped={...ctx,db:tx};await lockOrg(scoped);
  const [a]=rows<Definition>(await tx.execute(sql`select * from agent_definitions where id=${id} and org_id=${ctx.orgId} and owner_id=${ctx.userId} for update`));
  if(!a)throw notFound('Agent');
  if(enabled){
   const c=agentConfigSchema.parse(a.config);await verifyConfig(scoped,c);
   if(!await isolated(scoped,c.subscriptionId))throw conflict('A verified production subscription and exclusive execution mode are required.');
   if(c.schedule.kind==='DAILY'){
    // Scheduled activation requires successful live execution of this exact revision and subscription.
    if(!rows(await tx.execute(sql`select id from agent_runs where agent_id=${id} and revision=${a.revision}
      and state='COMPLETED' and snapshot->'config'->>'subscriptionId'=${c.subscriptionId} limit 1`)).length)
      throw conflict('Complete a real manual run of this agent revision before enabling its daily schedule.');
   }
   if(rows(await tx.execute(sql`select id from agent_definitions where org_id=${ctx.orgId} and brand_id=${a.brand_id} and enabled and id<>${id}`)).length)throw conflict('Another enabled agent already owns this creator.');
  }
  await tx.execute(sql`update agent_definitions set enabled=${enabled},updated_at=now() where id=${id}`);
  await audit(scoped,'agent.definition.enable',{type:'agent',id},undefined,{enabled});
  return {id,enabled};
 });
}
export async function startAgentRun(ctx:Ctx,id:string,scheduled=false){
 return ctx.db.transaction(async tx=>{
  const scoped={...ctx,db:tx};await lockOrg(scoped);
  const [a]=rows<Definition>(await tx.execute(sql`select * from agent_definitions where id=${id} and org_id=${ctx.orgId} and owner_id=${ctx.userId} for update`));
  if(!a)throw notFound('Agent');
  const c=agentConfigSchema.parse(a.config);const clock=await localClock(scoped);
  if(scheduled&&(!a.enabled||!scheduleDue(c,clock.time)))return null;
  // One logical daily run per creator agent. Manual activation uses the same slot to prevent overlap.
  const slot=clock.day;
  const [existing]=rows<Run>(await tx.execute(sql`select * from agent_runs where agent_id=${id} and slot=${slot}`));
  if(existing)return existing;
  if(rows(await tx.execute(sql`select id from agent_runs where agent_id=${id} and state in ('ACTIVE','PAUSED')`)).length)throw conflict('Finish or stop the previous run.');
  if(!await isolated(scoped,c.subscriptionId))throw conflict('Production subscription or exclusive execution mode is unavailable.');
  await verifyConfig(scoped,c);
  if((await runPrefs(scoped))[c.brandId]?.paused)throw conflict('Creator production is paused.');
  const [profile]=rows<{reference_file_ids:string[]}>(await tx.execute(sql`select reference_file_ids from ai_profiles where org_id=${ctx.orgId} and brand_id=${c.brandId}`));
  const refs=profile?.reference_file_ids??[];
  if(isVideo(c)&&(refs.length<1||refs.length>3))throw badRequest('H3 needs one to three approved canonical reference images.');
  let projectId=c.projectId,productionRunId:string|null=null,planId:string|null=null;
  if(isVideo(c)){
   const [pr]=rows<{id:string}>(await tx.execute(sql`insert into production_runs(org_id,brand_id,local_day,target)
     values(${ctx.orgId},${c.brandId},${clock.day}::date,1) on conflict do nothing returning id`));
   if(!pr)throw conflict('Another production run already owns this creator and Vancouver day. Disable the overlapping producer.');
   productionRunId=pr.id;planId=c.workflow==='H3_SHORT'?randomUUID():null;
   const project=await createDraftProject(tx,scoped,{title:c.name+' · '+clock.day,brandId:c.brandId,type:'OTHER',contentFormat:'OTHER',brief:c.instructions});
   projectId=project.id;
   await runEvent(tx,ctx.orgId,pr.id,'RESEARCHING','Native agent owns this production run.');
  }
  const snapshot:Snapshot={config:c,referenceFileIds:refs};
  const [run]=rows<Run>(await tx.execute(sql`insert into agent_runs(agent_id,org_id,owner_id,brand_id,slot,revision,snapshot,project_id,production_run_id,plan_id)
   values(${id},${ctx.orgId},${ctx.userId},${c.brandId},${slot},${a.revision},${JSON.stringify(snapshot)}::jsonb,${projectId},${productionRunId},${planId}) returning *`));
  await tx.execute(sql`insert into agent_run_events(run_id,state,stage,detail) values(${run!.id},'ACTIVE',0,'Run admitted.')`);
  await audit(scoped,'agent.run.start',{type:'agent_run',id:run!.id},undefined,{agentId:id,slot,scheduled});
  return run!;
 });
}
async function getTask(ctx:Ctx,r:Run,key:string){
 return rows<TaskRow>(await ctx.db.execute(sql`select id,state,result,error_code from agent_tasks where agent_run_id=${r.id} and stage_key=${key}`))[0];
}
async function resultFor(ctx:Ctx,r:Run,key:string){
 const t=await getTask(ctx,r,key);
 if(t?.state!=='COMPLETED')throw conflict('Prior task is not completed: '+key);
 return agentTaskResult.parse(t.result);
}
async function updateRun(ctx:Ctx,r:Run,detail:string,patch:{stage?:number;state?:string;jobId?:string;fileId?:string}={}){
 const [previous]=rows<{detail:string|null;state:string;stage:number}>(await ctx.db.execute(sql`select detail,state,stage from agent_runs where id=${r.id} for update`));
 if(!previous||previous.state!=='ACTIVE')return;
 await ctx.db.execute(sql`update agent_runs set detail=${detail.slice(0,2000)},stage=coalesce(${patch.stage??null}::int,stage),
 state=coalesce(${patch.state??null},state),job_id=coalesce(${patch.jobId??null}::uuid,job_id),
 file_id=coalesce(${patch.fileId??null}::uuid,file_id),updated_at=now() where id=${r.id} and state='ACTIVE'`);
 if(previous.detail!==detail||patch.state||patch.stage!==undefined)await ctx.db.execute(sql`insert into agent_run_events(run_id,state,stage,detail) values(${r.id},${patch.state??previous.state},${patch.stage??previous.stage},${detail.slice(0,2000)})`);
 if(patch.state==='BLOCKED'&&r.production_run_id){
  const [p]=rows<{state:string}>(await ctx.db.execute(sql`select state from production_runs where id=${r.production_run_id} and org_id=${r.org_id}`));
  if(p?.state==='ACTIVE')await controlProductionRun(ctx,r.production_run_id,'pause');
 }
}
async function queueStage(ctx:Ctx,r:Run,key:string,input:AgentTaskInput){
 const c=r.snapshot.config;
 const existing=await getTask(ctx,r,key);
 if(existing){
  if(existing.state==='COMPLETED')return true;
  if(active.includes(existing.state)){await updateRun(ctx,r,key+' · '+existing.state);return false;}
  await updateRun(ctx,r,key+' · '+(existing.error_code??existing.state),{state:'BLOCKED'});return false;
 }
 try{await createAgentTask(ctx,c.subscriptionId,randomUUID(),agentTaskInput.parse(input),
   {runId:r.id,stageKey:key,dailyTasks:c.dailyTasks,dailyImages:c.dailyImages,vidiqCredits:c.vidiqCredits});}
 catch(e){if(e instanceof AppError&&e.code==='AGENT_ACTIVE_CAPACITY'){await updateRun(ctx,r,'Waiting for an active agent task slot.');return false;}throw e;}
 await updateRun(ctx,r,key+' queued');
 return false;
}
async function advance(ctx:Ctx,r:Run){
 const c=agentConfigSchema.parse(r.snapshot.config),refs=r.snapshot.referenceFileIds;
 const stages=workflowStages(c),key=stages[r.stage];
 if(!key){await updateRun(ctx,r,'Workflow complete.',{state:'COMPLETED'});return;}
 const research=c.research==='VIDIQ'&&key!=='RESEARCH'?await resultFor(ctx,r,'RESEARCH'):null;
 const common={brandId:r.brand_id,projectId:r.project_id,instructions:taskInstructions(c,research)};
 const next=async()=>updateRun(ctx,r,key+' completed.',{stage:r.stage+1});
 if(r.production_run_id)await ctx.db.execute(sql`update production_runs set updated_at=now() where id=${r.production_run_id} and state='ACTIVE'`);
 if(key==='RESEARCH'){
  if(await queueStage(ctx,r,key,{...common,taskType:'RESEARCH',provider:'VIDIQ',query:c.researchQuery!,
    reservedCredits:c.vidiqWatch?15:5,watch:c.vidiqWatch}))await next();
  return;
 }
 if(key==='CONTENT_STRATEGY'){
  if(await queueStage(ctx,r,key,{...common,taskType:key}))await next();return;
 }
 if(key==='SCRIPT_GENERATION'){
  const prior=await resultFor(ctx,r,'CONTENT_STRATEGY');
  if(await queueStage(ctx,r,key,{...common,taskType:key,instructions:taskInstructions(c,prior)}))await next();return;
 }
 if(key==='PRODUCTION_PLANNING'){
  if(await queueStage(ctx,r,key,{...common,projectId:r.project_id!,taskType:key,durationSec:c.durationSec,aspect:c.aspect}))await next();return;
 }
 if(key==='IMAGE_GENERATION'){
  let instructions=common.instructions;
  if(isVideo(c)){
   const plan=await resultFor(ctx,r,'PRODUCTION_PLANNING');if(plan.taskType!=='PRODUCTION_PLANNING')throw conflict('Invalid plan.');
   instructions=taskInstructions(c,{imagePrompt:plan.imagePrompt,brief:plan.brief});
  }
  if(await queueStage(ctx,r,key,{...common,projectId:r.project_id!,taskType:'IMAGE_GENERATION',referenceFileIds:refs,aspect:c.aspect,instructions}))await next();return;
 }
 if(key==='RENDER'){
  const plan=await resultFor(ctx,r,'PRODUCTION_PLANNING'),image=await resultFor(ctx,r,'IMAGE_GENERATION');
  if(plan.taskType!=='PRODUCTION_PLANNING'||image.taskType!=='IMAGE_GENERATION')throw conflict('Missing verified render inputs.');
  if(c.workflow==='LTX_SHORT'){
   if(!r.job_id){
    const audio=await verifyLtxAudio(ctx,c);
    const workflow=ltxApiWorkflow();if(!workflow)throw badRequest('LTX workflow is not installed.');
    await reserveRender(ctx,1);
    const [width,height]=c.aspect==='9:16'?[576,1024]:c.aspect==='16:9'?[1024,576]:[768,768];
    await ctx.db.execute(sql`update creative_projects set title=${plan.title},brief=${plan.brief},updated_at=now() where id=${r.project_id} and org_id=${r.org_id} and stage='DRAFT'`);
    const generated=await generateLtx(ctx,{projectId:r.project_id,workerId:c.workerId,imageFileId:image.fileId,audioFileId:audio.audioFileId,
     audioStartSec:audio.audioStartSec,durationSec:c.durationSec,prompt:[plan.masterPrompt,...plan.segments.map(s=>s.prompt)].join('\n').slice(0,16000),
     negativePrompt:workflow.preset.negativePrompt,width:width!,height:height!,fps:30,loraName:audio.loraName,loraStrength:audio.loraStrength,
     upscaleWidth:width!,upscaleHeight:height!,wantUpscale:false,imageUploadName:null,imageUploadWorkerId:null,audioUploadName:null,audioUploadWorkerId:null},{skipDraft:true});
    const jobId=generated.job.id;
    await ctx.db.execute(sql`update generation_jobs set settings=settings||${JSON.stringify({nativeAgentRunId:r.id,productionRunId:r.production_run_id,sourceEvidence:research?JSON.stringify({hostReported:true,source:research}).slice(0,20000):'Original owner-directed content',creativeOwner:'chatgpt',postProduction:{phase:'WAIT_INDEX'}})}::jsonb where id=${jobId} and org_id=${r.org_id}`);
    await ctx.db.execute(sql`update production_runs set planning_state='PLANNED',planning_detail='Native LTX render queued.',updated_at=now() where id=${r.production_run_id}`);
    await setAutomatedProjectStage(ctx.db,r.org_id,r.project_id,'IN_PROGRESS','Native LTX render queued.');
    await runEvent(ctx.db,r.org_id,r.production_run_id,'RENDER_QUEUED','LTX render queued.',jobId);
    await updateRun(ctx,r,'LTX render queued.',{jobId});return;
   }
   const [job]=rows<{status:string;file_id:string|null}>(await ctx.db.execute(sql`
    select j.status,(select f.id from generation_outputs o join file_instances f on f.id=o.file_instance_id and f.org_id=o.org_id
     where o.job_id=j.id and o.org_id=j.org_id and o.output_role='original' and f.availability='AVAILABLE' and f.archived_at is null
     and f.file_type='VIDEO' order by o.created_at desc limit 1) as file_id
    from generation_jobs j where j.id=${r.job_id} and j.org_id=${r.org_id} and j.project_id=${r.project_id} and j.settings->>'nativeAgentRunId'=${r.id}`));
   if(!job||['FAILED','CANCELLED'].includes(job.status))throw conflict('LTX render failed; inspect exact job before retrying.');
   if(job.status!=='SUCCEEDED'||!job.file_id){await updateRun(ctx,r,'Waiting for indexed LTX original output.');return;}
   await updateRun(ctx,r,'Exact LTX output indexed.',{stage:r.stage+1,fileId:job.file_id});return;
  }
  const [existing]=rows<{state:string;job_id:string|null;detail:string|null}>(await ctx.db.execute(sql`select state,job_id,detail from production_plans where id=${r.plan_id} and org_id=${r.org_id} and project_id=${r.project_id}`));
  if(!existing){
   // Preserve project creation/audit and existing production plan idempotency. No billable fallback.
   await ctx.db.execute(sql`update creative_projects set title=${plan.title},brief=${plan.brief},updated_at=now() where id=${r.project_id} and org_id=${r.org_id} and stage='DRAFT'`);
   await reserveRender(ctx,1+c.maxRegenerations);
   const images=[...refs,image.fileId].map(fileId=>({fileId,uploadName:null,uploadWorkerId:null,shared:true}));
   const form={projectId:r.project_id,workerId:c.workerId,imageFileId:null,imageUploadName:null,imageUploadWorkerId:null,
    prompt:plan.masterPrompt,aspectRatio:c.aspect,megapixels:1,audioLocked:true,shareAudio:false,videoLocked:true,shareVideo:false,
    segments:plan.segments.map(s=>({...s,taskMode:'ref',refImageSize:'max',audioFileId:null,audioUploadName:null,audioUploadWorkerId:null,images}))};
   await submitProductionPlan(ctx,productionPlanInputSchema.parse({runId:r.production_run_id,form,sourceEvidence:research?JSON.stringify({hostReported:true,source:research}).slice(0,20000):'Original owner-directed content; no external research claimed.',brief:plan.brief,assets:[],qualityReferenceFileIds:refs,requireAudio:false,requireLipSync:false,requirePhysicalAccuracy:true,maxRegenerations:c.maxRegenerations,acceptBillableQuality:false,qualityProvider:'chatgpt'}),r.plan_id!);
   await updateRun(ctx,r,'H3 production plan saved.');return;
  }
  if(['FAILED','STOPPED'].includes(existing.state))throw conflict('H3 plan requires review.');
  if(existing.state==='REVIEW'&&!existing.job_id)throw conflict('H3 plan requires review before render.');
  if(!existing.job_id){await updateRun(ctx,r,'H3 '+existing.state);return;}
  const [job]=rows<{status:string;file_id:string|null}>(await ctx.db.execute(sql`
   select j.status,(select f.id from generation_outputs o join file_instances f on f.id=o.file_instance_id and f.org_id=o.org_id
     where o.job_id=j.id and o.org_id=j.org_id and o.output_role='final' and f.availability='AVAILABLE' and f.archived_at is null and f.file_type='VIDEO'
     order by o.created_at desc limit 1) as file_id
   from generation_jobs j where j.id=${existing.job_id} and j.org_id=${r.org_id} and j.project_id=${r.project_id}`));
  if(!job||['FAILED','CANCELLED'].includes(job.status))throw conflict('Render failed; inspect exact job before retrying.');
  if(job.status!=='SUCCEEDED'||!job.file_id||!['QUALITY','REVIEW','PASSED'].includes(existing.state)){
   await updateRun(ctx,r,'Waiting for indexed H3 output.');return;
  }
  await updateRun(ctx,r,'Exact render indexed.',{stage:r.stage+1,jobId:existing.job_id,fileId:job.file_id});return;
 }
 if(key==='VIDEO_REVIEW'){
  const seconds=[0.25,0.35*c.durationSec,0.65*c.durationSec,0.9*c.durationSec].map(x=>Math.round(x*100)/100);
  const reviewKey=key+':'+r.job_id;
  const ready=await queueStage(ctx,r,reviewKey,{...common,projectId:r.project_id!,taskType:key,jobId:r.job_id!,fileId:r.file_id!,referenceFileIds:refs,frameSeconds:seconds,
    instructions:taskInstructions(c,await resultFor(ctx,r,'PRODUCTION_PLANNING'))});
  if(!ready)return;
  const report=await resultFor(ctx,r,reviewKey);if(report.taskType!=='VIDEO_REVIEW')throw conflict('Missing quality assessment.');
  const quality=await submitChatGPTQualityReport(ctx,{jobId:r.job_id!,fileId:r.file_id!,assessment:report.assessment,
   evidence:{frameSeconds:report.frameSeconds,continuousMotion:false,audioHeard:false,lipSyncObserved:false},
   requireAudio:c.workflow==='LTX_SHORT',requireLipSync:false,requirePhysicalAccuracy:true});
  if(!quality.eligible){
   const failures=report.assessment.checks.filter(ch=>ch.status==='FAIL');
   const corrective=c.workflow==='H3_SHORT'&&c.maxRegenerations>0&&quality.verdict==='FAIL'&&!quality.technical.defects.length
      &&failures.length>0&&failures.every(ch=>['brief','continuity','artifacts'].includes(ch.criterion));
   if(corrective){
    const corrected=rows(await ctx.db.execute(sql`
      update production_plans set state='REGENERATE',payload=payload||${JSON.stringify({corrections:quality.corrections})}::jsonb,
      detail='Confirmed visual defect; bounded prompt correction.',updated_at=now()
      where id=${r.plan_id} and org_id=${r.org_id} and job_id=${r.job_id} and state='REVIEW'
      and lease is null and attempt<=${c.maxRegenerations} returning id`));
    if(corrected.length){await updateRun(ctx,r,'Confirmed visual defects: one reserved H3 correction.',{stage:r.stage-1});return;}
   }
   await updateRun(ctx,r,'Quality defects require targeted owner review; no unsafe rerender.',{state:'BLOCKED'});return;
  }
  await next();return;
 }
 if(key==='SEO_GENERATION'){
  const readiness=await productionReadiness(ctx,{jobId:r.job_id!,fileId:r.file_id!});
  if(!readiness.itemId||!readiness.accounts.length)throw conflict('Exact publishing item or creator accounts unavailable.');
  const accounts=readiness.accounts.map(a=>({accountId:a.accountId,platform:a.platform}));
  if(await queueStage(ctx,r,key,{...common,projectId:r.project_id!,taskType:key,jobId:r.job_id!,fileId:r.file_id!,accounts,
    instructions:taskInstructions(c,await resultFor(ctx,r,'PRODUCTION_PLANNING'))}))await next();return;
 }
 if(key==='THUMBNAIL'){
  const seo=await resultFor(ctx,r,'SEO_GENERATION'),image=await resultFor(ctx,r,'IMAGE_GENERATION');
  if(seo.taskType!=='SEO_GENERATION'||image.taskType!=='IMAGE_GENERATION')throw conflict('Missing publishing package inputs.');
  if(await queueStage(ctx,r,key,{...common,projectId:r.project_id!,taskType:'IMAGE_GENERATION',
    referenceFileIds:[...new Set([...refs,image.fileId])],aspect:c.aspect,
    instructions:taskInstructions(c,{thumbnailPrompt:seo.thumbnailPrompt})}))await next();return;
 }
 if(key==='FINALIZE'){
  const seo=await resultFor(ctx,r,'SEO_GENERATION'),thumb=await resultFor(ctx,r,'THUMBNAIL');
  if(seo.taskType!=='SEO_GENERATION'||thumb.taskType!=='IMAGE_GENERATION')throw conflict('Missing publishing package.');
  const target={jobId:r.job_id!,fileId:r.file_id!};
  const readiness=await productionReadiness(ctx,target);
  if(!readiness.eligible||!readiness.itemId||!readiness.accounts.length)throw conflict('Publishing readiness changed.');
  const expected=readiness.accounts.map(a=>a.accountId).sort();
  if(JSON.stringify(expected)!==JSON.stringify(seo.drafts.map(d=>d.accountId).sort()))throw conflict('Creator accounts changed; regenerate metadata.');
  const source=await openAgentFile(ctx.db,ctx.env,ctx.orgId,thumb.fileId,(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(30000)}));
  const cap=socialCoverLimit(ctx.env.processEnv.AI_GATEWAY_THUMBNAIL_MAX_MIB);
  if(source.size>cap){await source.body.cancel();throw badRequest('Thumbnail exceeds configured size limit.');}
  const reader=source.body.getReader();const chunks:Buffer[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>cap)throw badRequest('Thumbnail too large.');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>undefined);}
  const bytes=Buffer.concat(chunks);
  for(const d of seo.drafts){
   const account=readiness.accounts.find(a=>a.accountId===d.accountId)!;
   const [current]=rows<{state:string}>(await ctx.db.execute(sql`select upload_state as state from publish_drafts where org_id=${ctx.orgId} and item_id=${readiness.itemId} and social_account_id=${d.accountId} for update`));
   if(current&&current.state!=='DRAFT')throw conflict('An existing draft was already sent or scheduled.');
   await ctx.db.insert(publishDrafts).values({orgId:ctx.orgId,itemId:readiness.itemId,socialAccountId:d.accountId,
    title:d.title,caption:d.caption,hashtags:d.hashtags.map(x=>x.replace(/^#/,'')),privacy:account.platform==='youtube'?'PRIVATE':null,aiUse:'YES'}).onConflictDoNothing();
   // Preserve owner-entered text and covers. Only fill missing draft fields.
   await ctx.db.execute(sql`update publish_drafts set title=coalesce(nullif(trim(title),''),${d.title}),caption=coalesce(nullif(trim(caption),''),${d.caption}),
     hashtags=case when cardinality(hashtags)=0 then ARRAY(select jsonb_array_elements_text(${JSON.stringify(d.hashtags.map(x=>x.replace(/^#/,'')))}::jsonb)) else hashtags end,
     ai_use=coalesce(ai_use,'YES'),updated_at=now() where org_id=${ctx.orgId} and item_id=${readiness.itemId} and social_account_id=${d.accountId} and upload_state='DRAFT'`);
   if(!await readSocialCover(ctx,ctx.orgId,readiness.itemId,d.accountId))await saveSocialCoverBytes(ctx,r.project_id!,readiness.itemId,d.accountId,bytes);
  }
  const result=await finalizeChatGPTProduction(ctx,target);
  if(!result.ready)throw conflict('Authoritative readiness gate: '+result.missing.join(', '));
  await updateRun(ctx,r,'Project READY for human review. Nothing was published.',{stage:r.stage+1,state:'COMPLETED'});return;
 }
}
export async function runDueAgentStudio(db:Db,env:ServiceEnv){
 const defs=rows<Definition>(await db.execute(sql`
  select a.* from agent_definitions a join ai_gateway_connections g on g.org_id=a.org_id
  where a.enabled and g.agent_exclusive and g.enabled and g.mode='hosted' and g.hosted_owner=a.owner_id
  and a.config->'schedule'->>'kind'='DAILY' order by a.updated_at limit 50`));
 for(const a of defs){try{await startAgentRun(ownerCtx(db,env,a),a.id,true);await db.execute(sql`update agent_definitions set last_error=null where id=${a.id} and last_error is not null`);}catch(e){const message=e instanceof AppError?e.message:'Scheduled admission failed; inspect worker logs.';await db.execute(sql`update agent_definitions set last_error=${message.slice(0,1000)} where id=${a.id}`);}}
 const pending=rows<Run>(await db.execute(sql`select * from agent_runs where state='ACTIVE' order by updated_at,id limit 20`));
 for(const r of pending){
  const ctx=ownerCtx(db,env,r);
  try{
   await db.transaction(async tx=>{
    const scoped={...ctx,db:tx};await lockOrg(scoped);
    const [current]=rows<Run>(await tx.execute(sql`select * from agent_runs where id=${r.id} and state='ACTIVE' for update skip locked`));
    if(!current)return;
    if(!await isolated(scoped,current.snapshot.config.subscriptionId)){
     await updateRun(scoped,current,'Production subscription or exclusive execution unavailable.',{state:'BLOCKED'});return;
    }
    if((await runPrefs(scoped))[current.brand_id]?.paused){await updateRun(scoped,current,'Creator production paused.');return;}
    if(current.production_run_id){
     const [pr]=rows<{state:string}>(await tx.execute(sql`select state from production_runs where id=${current.production_run_id} and org_id=${current.org_id}`));
     if(pr?.state!=='ACTIVE'){await updateRun(scoped,current,'Existing production run paused or stopped.',{state:'BLOCKED'});return;}
    }
    await advance(scoped,current);
   });
  }catch(e){
   // Transaction rollback means no new task/plan was committed. Do not blindly retry an uncertain external write.
   await db.transaction(async tx=>{
    const scoped={...ctx,db:tx};await lockOrg(scoped);
    const [current]=rows<Run>(await tx.execute(sql`select * from agent_runs where id=${r.id} and state='ACTIVE' and stage=${r.stage} for update`));
    if(current)await updateRun(scoped,current,e instanceof AppError?e.message:'Stage failed; inspect existing task or production records.',{state:'BLOCKED'});
   });
  }
 }
 return {definitions:defs.length,runs:pending.length};
}
export async function controlAgentRun(ctx:Ctx,id:string,action:'pause'|'resume'|'stop'){
 return ctx.db.transaction(async tx=>{
  const scoped={...ctx,db:tx};await lockOrg(scoped);
  const [r]=rows<Run>(await tx.execute(sql`select * from agent_runs where id=${id} and org_id=${ctx.orgId} and owner_id=${ctx.userId} for update`));
  if(!r)throw notFound('Agent run');
  if(action==='pause'&&r.state!=='ACTIVE'||action==='resume'&&!['PAUSED','BLOCKED'].includes(r.state)||action==='stop'&&!['ACTIVE','PAUSED','BLOCKED','FAILED'].includes(r.state))throw conflict('Invalid run transition.');
  if(action==='resume'){
   if(!await isolated(scoped,r.snapshot.config.subscriptionId))throw conflict('Reconnect isolated execution first.');
   if(r.slot!==(await localClock(scoped)).day)throw conflict('An old daily slot cannot be resumed.');
   if(rows(await tx.execute(sql`select id from agent_runs where agent_id=${r.agent_id} and id<>${r.id} and state in ('ACTIVE','PAUSED')`)).length)throw conflict('Another run owns this agent.');
   if(r.state==='BLOCKED'&&rows(await tx.execute(sql`select id from agent_tasks where agent_run_id=${r.id} and state<>'COMPLETED' and not (state='QUEUED' and attempts=0)`)).length)throw conflict('Resolve failed or uncertain tasks before resuming; no automatic replay.');
  }
  if(r.production_run_id)await controlProductionRun(scoped,r.production_run_id,action);
  const state=action==='pause'?'PAUSED':action==='resume'?'ACTIVE':'STOPPED';
  await tx.execute(sql`update agent_runs set state=${state},detail=${'Owner '+action},updated_at=now() where id=${id}`);
  if(action==='stop')await tx.execute(sql`update agent_tasks set state='CANCELLED',terminal_at=now(),lease_until=null,error_code='run_stopped' where agent_run_id=${id} and state in ('QUEUED','DISPATCHED','DELIVERED','CLAIMED','RUNNING')`);
  if(action==='resume')await tx.execute(sql`update agent_tasks set deadline_at=now()+interval '30 minutes',next_attempt_at=now() where agent_run_id=${id} and state='QUEUED' and attempts=0`);
  await tx.execute(sql`insert into agent_run_events(run_id,state,stage,detail) values(${id},${state},${r.stage},${'Owner '+action})`);
  await audit(scoped,'agent.run.'+action,{type:'agent_run',id});
  return {id,state};
 });
}
