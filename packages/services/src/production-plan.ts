import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql, type Db } from '@creatoros/db';
import { redactSecrets } from '@creatoros/domain';
import { h3Form } from './h3-form';
import { generateH3 } from './h3';
import { getAiProfile, inspectProductionSemantics, aiStatus } from './ai';
import { localImageInputSchema, validateLocalImageInput, queueLocalImage, localImageStatus, type LocalImageSnapshot } from './local-image';
import { inspectTechnicalVideo, qualityDecision, type QualityRequirements, type SemanticQuality } from './production-quality';
import { runEvent, runPrefs } from './production-run';
import { audit } from './audit';
import { notify } from './notifications';
import { badRequest, conflict, notFound, systemCtx, type Ctx, type ServiceEnv } from './types';

const rows=<T>(r:unknown)=>(r as {rows:T[]}).rows;
export const productionPlanInputSchema=z.object({
  runId:z.uuid(), form:h3Form, sourceEvidence:z.string().trim().min(1).max(20000),
  brief:z.string().trim().min(1).max(12000),
  assets:z.array(z.object({image:localImageInputSchema,segmentIndexes:z.array(z.number().int().min(0).max(7)).min(1).max(8)}).strict()).max(4),
  qualityReferenceFileIds:z.array(z.uuid()).max(4),
  requireAudio:z.boolean(),requireLipSync:z.boolean(),requirePhysicalAccuracy:z.boolean(),
  maxRegenerations:z.number().int().min(0).max(2),acceptBillableQuality:z.literal(true),
}).strict();
type Input=z.infer<typeof productionPlanInputSchema>;
type Payload=Input & {assetIds:string[];assetSnapshots:LocalImageSnapshot[];reviewRefs:string[];corrections?:string[];imageRetries?:number[];inspectionRetryFor?:number;reviewStage?:string};
type Plan={id:string;orgId:string;runId:string;projectId:string;brandId:string;payload:Payload;state:string;attempt:number;jobId:string|null;quality:unknown;detail:string|null;lease:string|null;updatedAt:string};
const columns=sql`p.id,p.org_id as "orgId",p.run_id as "runId",p.project_id as "projectId",p.brand_id as "brandId",p.payload,p.state,p.attempt,p.job_id as "jobId",p.quality,p.detail,p.lease,p.updated_at as "updatedAt"`;
type Form=z.output<typeof h3Form>;
function requirements(p:Input):QualityRequirements {
  return {duration:p.form.segments.reduce((n,s)=>n+(s.durationSec??0),0),aspectRatio:p.form.aspectRatio,requireAudio:p.requireAudio||p.requireLipSync,requireLipSync:p.requireLipSync,requirePhysicalAccuracy:p.requirePhysicalAccuracy};
}
async function available(ctx:Ctx,id:string|null|undefined,kind:string){
  if(!id)return;
  if(!rows(await ctx.db.execute(sql`select id from file_instances where id=${id} and org_id=${ctx.orgId} and file_type::text=${kind} and availability='AVAILABLE' and archived_at is null`)).length)throw badRequest('Required '+kind+' library asset unavailable.');
}
export function validatePlanShape(input:Input) {
  const f=input.form;
  if(!f.projectId||!f.workerId||!f.segments.length||f.segments.length>8||!f.prompt.trim()||f.prompt.length>12000)throw badRequest('Choose a project, GPU, master prompt and ordered segments.');
  if(f.imageUploadName||f.imageUploadWorkerId||f.segments.some(s=>s.audioUploadName||s.audioUploadWorkerId||s.videoUploadName||s.videoUploadWorkerId||s.images.some(i=>i.uploadName||i.uploadWorkerId)))throw badRequest('Use verified library IDs, not worker filenames.');
  if(requirements(input).duration>30||!/^\d+:\d+/.test(f.aspectRatio)||f.segments.some(s=>!s.durationSec||!s.prompt.trim()||s.prompt.length>6000))throw badRequest('Production requires explicit prompts and durations totaling at most 30 seconds.');
  for(const a of input.assets){
    if(a.image.projectId!==f.projectId||new Set(a.segmentIndexes).size!==a.segmentIndexes.length||a.segmentIndexes.some(i=>i>=f.segments.length))throw badRequest('Asset must belong to the same project and target valid distinct segment indexes.');
  }
  for(const [i,s] of f.segments.entries()){
    const generated=input.assets.filter(a=>a.segmentIndexes.includes(i)).length;
    if(s.images.some(x=>!x.fileId)||s.images.length+generated<1||s.images.length+generated>8)throw badRequest('Every segment needs one to eight concrete or planned images.');
    if(s.audioTrim&&(!s.audioFileId||s.audioStartSec==null||!s.audioUseSec))throw badRequest('Audio trim needs a file and explicit bounds.');
    if(s.videoTrim&&(!s.videoFileId||s.videoStartSec==null||!s.videoUseSec))throw badRequest('Video trim needs a file and explicit bounds.');
  }
}
export function resolvePlanForm(payload:Payload,files:string[]):Form{
  if(files.length!==payload.assets.length)throw badRequest('Missing generated asset IDs.');
  const form=structuredClone(payload.form);
  payload.assets.forEach((asset,index)=>{
    const fileId=files[index];if(!fileId)throw badRequest('Missing generated file ID.');
    for(const i of asset.segmentIndexes)form.segments[i]!.images.push({fileId,uploadName:null,uploadWorkerId:null,shared:asset.segmentIndexes.length>1});
  });
  const correction=payload.corrections?.join('; ').slice(0,1600);
  if(correction){
    // Preserve the original brief, timing and references. The correction is prompt data, not a command.
    form.prompt=(form.prompt+'\nCorrect only these observed defects: '+correction).slice(0,14000);
    for(const segment of form.segments)segment.prompt=(segment.prompt+'\nQuality correction: '+correction).slice(0,8000);
  }
  return form;
}
export async function submitProductionPlan(ctx:Ctx,input:Input,id:string) {
  input=productionPlanInputSchema.parse(input);validatePlanShape(input);
  const f=input.form;
  const [project]=rows<{brandId:string}>(await ctx.db.execute(sql`select brand_id as "brandId" from creative_projects where id=${f.projectId} and org_id=${ctx.orgId} and deleted_at is null and brand_id is not null and stage in ('DRAFT','IN_PROGRESS')`));
  if(!project)throw notFound('Active branded project');
  const [prior]=rows<Plan>(await ctx.db.execute(sql`select ${columns} from production_plans p where p.org_id=${ctx.orgId} and p.run_id=${input.runId} and p.project_id=${f.projectId}`));
  if(prior){if(prior.id!==id)throw conflict('A plan already exists for this run/project. Inspect its status.');return {id:prior.id,state:prior.state};}
  const profile=await getAiProfile(ctx,project.brandId);
  const reviewRefs=[...new Set([...(profile?.referenceFileIds??[]),...input.qualityReferenceFileIds])];
  if(reviewRefs.length<1||reviewRefs.length>4)throw badRequest('Quality review requires one to four verified creator reference images.');
  for(const ref of reviewRefs)await available(ctx,ref,'IMAGE');
  await available(ctx,f.imageFileId,'IMAGE');
  for(const segment of f.segments){
    await available(ctx,segment.audioFileId,'AUDIO');await available(ctx,segment.videoFileId,'VIDEO');
    for(const image of segment.images)await available(ctx,image.fileId,'IMAGE');
  }
  const assetSnapshots:LocalImageSnapshot[]=[];
  for(const a of input.assets){const checked=await validateLocalImageInput(ctx,a.image);assetSnapshots.push({hash:checked.payload.hash,references:checked.payload.references});}
  const provider=await aiStatus(ctx);
  if(provider.gemini!=='CONFIGURED'||!provider.settings.enabled)throw badRequest('Configure enabled Gemini quality inspection before accepting this plan. No render has been started.');
  if(!rows(await ctx.db.execute(sql`select id from gpu_workers where id=${f.workerId} and org_id=${ctx.orgId} and enabled`)).length)throw notFound('Enabled H3 GPU');
  if((await runPrefs(ctx))[project.brandId]?.paused)throw conflict('Creator production is paused.');
  const payload:Payload={...input,reviewRefs,assetSnapshots,assetIds:input.assets.map(()=>randomUUID()),imageRetries:input.assets.map(()=>0)};
  return ctx.db.transaction(async tx=>{
    const [run]=rows<{target:number;state:string}>(await tx.execute(sql`select target,state from production_runs where id=${input.runId} and org_id=${ctx.orgId} and brand_id=${project.brandId} for update`));
    if(!run||run.state!=='ACTIVE')throw conflict('Select an active production run for this creator.');
    const [again]=rows<{id:string;state:string}>(await tx.execute(sql`select id,state from production_plans where org_id=${ctx.orgId} and run_id=${input.runId} and project_id=${f.projectId}`));
    if(again){if(again.id!==id)throw conflict('Plan already exists.');return again;}
    const [count]=rows<{n:number}>(await tx.execute(sql`select count(distinct project_id)::int as n from (select project_id from production_plans where org_id=${ctx.orgId} and run_id=${input.runId} union select project_id from generation_jobs where org_id=${ctx.orgId} and settings->>'productionRunId'=${input.runId} and coalesce(settings->>'productionSuperseded','false')<>'true') projects`));
    if((count?.n??0)>=run.target)throw conflict('Run already has its target number of plans/videos.');
    if(rows(await tx.execute(sql`select id from generation_jobs where org_id=${ctx.orgId} and project_id=${f.projectId} and settings->>'productionRunId'=${input.runId}`)).length)throw conflict('Project already has a render in this run.');
    const [created]=rows<{id:string;state:string}>(await tx.execute(sql`insert into production_plans(id,org_id,run_id,project_id,brand_id,payload,detail) values(${id},${ctx.orgId},${input.runId},${f.projectId},${project.brandId},${JSON.stringify(payload)}::jsonb,'Executable plan saved; preparing missing assets.') returning id,state`));
    await tx.execute(sql`update production_runs set planning_state='PLANNED',planning_detail='Executable production plan saved.',updated_at=now() where id=${input.runId} and org_id=${ctx.orgId}`);
    await runEvent(tx,ctx.orgId,input.runId,'PLAN_SAVED','Approved plan '+id+' saved; worker will prepare assets and render.');
    await audit({...ctx,db:tx},'production.plan.saved',{type:'production_run',id:input.runId},undefined,{planId:id,maxRegenerations:input.maxRegenerations});
    return created!;
  });
}
export async function productionPlanStatus(ctx:Ctx,id:string){
  const [p]=rows<Plan>(await ctx.db.execute(sql`select ${columns} from production_plans p where p.id=${id} and p.org_id=${ctx.orgId}`));
  if(!p)throw notFound('Production plan');
  const images=rows(await ctx.db.execute(sql`select id,state,file_id as "fileId",prompt_id as "promptId",error from local_image_jobs where org_id=${ctx.orgId} and id in (select jsonb_array_elements_text(${JSON.stringify(p.payload.assetIds)}::jsonb)::uuid)`));
  const attempts=rows(await ctx.db.execute(sql`select id,status,error,settings->'productionAttempt' as attempt,settings->'qualityReport' as quality,settings->'postProduction' as post from generation_jobs where org_id=${ctx.orgId} and settings->>'productionPlanId'=${id} order by created_at`));
  return {...p,images,attempts};
}
async function finish(ctx:Ctx,p:Plan,lease:string,state:string,detail:string,options:{jobId?:string;attempt?:number;quality?:unknown;payload?:Payload}={}){
  await ctx.db.transaction(async tx=>{
    const changed=rows(await tx.execute(sql`update production_plans set state=${state},detail=${detail.slice(0,2000)},attempt=coalesce(${options.attempt??null}::int,attempt),job_id=coalesce(${options.jobId??null}::uuid,job_id),quality=case when ${options.jobId!==undefined} then null else coalesce(${options.quality===undefined?null:JSON.stringify(options.quality)}::jsonb,quality) end,payload=coalesce(${options.payload===undefined?null:JSON.stringify(options.payload)}::jsonb,payload),lease=null,lease_at=null,updated_at=now() where id=${p.id} and org_id=${ctx.orgId} and lease=${lease} returning id`));
    if(!changed.length)return;
    if(options.quality!==undefined&&p.jobId){
      const passed=state==='PASSED';
      await tx.execute(sql`update generation_jobs set settings=settings||${JSON.stringify({qualityReport:options.quality,productionQualityPassed:passed,postProduction:{phase:passed?'WAIT_INDEX':'QUALITY_REJECTED',attempt:1,detail:passed?'Quality gate passed; preparing publishing package.':detail}})}::jsonb,updated_at=now() where id=${p.jobId} and org_id=${ctx.orgId} and settings->>'productionPlanId'=${p.id}`);
    }
    if(state!==p.state||detail!==p.detail)await runEvent(tx,ctx.orgId,p.runId,'PLAN_'+state,detail,p.jobId);
  });
  if(state==='FAILED'||state==='REVIEW')await notify(ctx.db,{orgId:ctx.orgId,type:'production.failed',dedupeKey:'production.plan:'+p.id+':'+p.attempt+':'+state,title:'Production plan needs review',body:detail.slice(0,180),severity:'WARNING',deepLink:'/today',sourceType:'production_run',sourceId:p.runId}).catch(()=>undefined);
}
async function finalFile(ctx:Ctx,p:Plan){
  const [file]=rows<{id:string}>(await ctx.db.execute(sql`select f.id from generation_outputs o join file_instances f on f.id=o.file_instance_id and f.org_id=o.org_id where o.org_id=${ctx.orgId} and o.job_id=${p.jobId} and o.output_role='final' and f.file_type='VIDEO' and f.archived_at is null and f.availability='AVAILABLE' order by o.created_at desc limit 1`));
  return file?.id;
}
async function advance(ctx:Ctx,p:Plan,lease:string){
  const payload=p.payload;
  if(p.state==='PREPARING'){
    for(const [i,a] of payload.assets.entries())await queueLocalImage(ctx,a.image,payload.assetIds[i]!,p.runId,payload.assetSnapshots[i]);
    return finish(ctx,p,lease,payload.assets.length?'WAIT_IMAGES':'QUEUE_VIDEO',payload.assets.length?'Waiting for generated image assets.':'All required references already available.');
  }
  if(p.state==='WAIT_IMAGES'||p.state==='QUEUE_VIDEO'||p.state==='REGENERATE'){
    const jobs=await Promise.all(payload.assetIds.map(id=>localImageStatus(ctx,id)));
    const failureIndex=jobs.findIndex(j=>['FAILED','UNCERTAIN','CANCELLED'].includes(j.state));
    if(failureIndex>=0){
      const failed=jobs[failureIndex]!;
      // A confirmed GPU execution failure may get one new seed; never retry an uncertain write.
      const retries=payload.imageRetries??payload.assets.map(()=>0);
      if(failed.state==='FAILED'&&failed.error==='ComfyUI reported image render failure.'&&(retries[failureIndex]??0)<1){
        const assetIds=[...payload.assetIds];assetIds[failureIndex]=randomUUID();
        const nextRetries=[...retries];nextRetries[failureIndex]=1;
        return finish(ctx,p,lease,'PREPARING','Confirmed local image render failure; one bounded recovery attempt.',{payload:{...payload,assetIds,imageRetries:nextRetries}});
      }
      return finish(ctx,p,lease,'REVIEW','Local asset requires review: '+(failed.error??failed.state),{payload:{...payload,reviewStage:p.state}});
    }
    if(jobs.some(j=>j.state!=='COMPLETE'||!j.fileId))return finish(ctx,p,lease,'WAIT_IMAGES','Waiting for local image output registration.');
    if(p.state==='WAIT_IMAGES')return finish(ctx,p,lease,'QUEUE_VIDEO','All generated assets have permanent library IDs.');
    const form=resolvePlanForm(payload,jobs.map(j=>j.fileId!));
    for(const segment of form.segments){for(const image of segment.images)await available(ctx,image.fileId,'IMAGE');await available(ctx,segment.audioFileId,'AUDIO');await available(ctx,segment.videoFileId,'VIDEO');}
    const next=p.attempt+1;
    if(next>1+payload.maxRegenerations)throw conflict('Regeneration budget exhausted.');
    const {job}=await generateH3(ctx,form,{runId:p.runId,sourceEvidence:payload.sourceEvidence,skipDraft:true,serialDispatch:true,productionPlanId:p.id,productionAttempt:next,retryOf:p.state==='REGENERATE'?p.jobId??undefined:undefined});
    return finish(ctx,p,lease,'WAIT_VIDEO','H3 attempt '+next+' queued.',{jobId:job.id,attempt:next});
  }
  if(p.state==='WAIT_VIDEO'){
    const [job]=rows<{status:string;error:string|null}>(await ctx.db.execute(sql`select status,error from generation_jobs where id=${p.jobId} and org_id=${ctx.orgId} and settings->>'productionPlanId'=${p.id}`));
    if(!job||['FAILED','CANCELLED'].includes(job.status))return finish(ctx,p,lease,'REVIEW','Render failed or was cancelled. Inspect the original GPU request; it was not replayed.');
    if(job.status!=='SUCCEEDED')return finish(ctx,p,lease,'WAIT_VIDEO','Waiting for H3 attempt '+p.attempt+'.');
    const file=await finalFile(ctx,p);
    if(!file){const [age]=rows<{stale:boolean}>(await ctx.db.execute(sql`select finished_at<now()-interval '1 day' as stale from generation_jobs where id=${p.jobId} and org_id=${ctx.orgId}`));return finish(ctx,p,lease,age?.stale?'REVIEW':'WAIT_VIDEO',age?.stale?'Final video has not been indexed; check scanner.':'Render finished; waiting for indexed final video.',age?.stale?{payload:{...payload,reviewStage:'WAIT_VIDEO'}}:{});}
    return finish(ctx,p,lease,'QUALITY','Indexed final video ready for quality inspection.');
  }
  if(p.state==='QUALITY'){
    const file=await finalFile(ctx,p);
    if(!file)throw badRequest('Indexed final output is no longer available.');
    const required=requirements(payload);
    const technical=await inspectTechnicalVideo(ctx,file,required);
    let semantic:SemanticQuality|null=null;
    if(!technical.defects.length){
      if(!payload.acceptBillableQuality)throw badRequest('Billable quality review not authorized.');
      semantic=await inspectProductionSemantics(ctx,{fileId:file,brandId:p.brandId,referenceFileIds:payload.reviewRefs,brief:payload.brief+'\nSource observations: '+payload.sourceEvidence+'\n'+payload.form.segments.map(s=>s.prompt).join('\n'),requirements:required});
    }
    const decision=qualityDecision(technical,semantic,required);
    const report={fileId:file,technical,semantic,...decision};
    if(decision.verdict==='PASS')return finish(ctx,p,lease,'PASSED','Automated quality gate passed; human review before publishing.',{quality:report});
    if(decision.verdict==='FAIL'&&p.attempt<=payload.maxRegenerations)return finish(ctx,p,lease,'REGENERATE','Observed defects; queue a corrected attempt within approved budget.',{quality:report,payload:{...payload,corrections:decision.corrections}});
    return finish(ctx,p,lease,'REVIEW',decision.verdict==='FAIL'?'Quality failed; regeneration budget exhausted.':'Quality evidence is uncertain; human review required.',{quality:report,payload:{...payload,reviewStage:'QUALITY'}});
  }
}
export async function recoverProductionPlan(ctx:Ctx,id:string,action:'resume'|'retry_inspection'){
  return ctx.db.transaction(async tx=>{
    const [p]=rows<Plan>(await tx.execute(sql`select ${columns} from production_plans p where p.id=${id} and p.org_id=${ctx.orgId} for update`));
    if(!p||p.state!=='REVIEW'||p.lease)throw conflict('Only a plan waiting for review can be recovered.');
    if(!rows(await tx.execute(sql`select id from production_runs where id=${p.runId} and org_id=${ctx.orgId} and state='ACTIVE'`)).length)throw conflict('Resume the production run first.');
    let state:string;let payload=p.payload;
    if(action==='retry_inspection'){
      if(p.attempt<1||payload.reviewStage!=='QUALITY'||payload.inspectionRetryFor===p.attempt||(p.quality as {verdict?:string}|null)?.verdict==='FAIL')throw conflict('Inspection retry is not available; failed or exhausted attempts cannot bypass the quality gate.');
      state='QUALITY';payload={...payload,inspectionRetryFor:p.attempt};
    }else{
      const stage=payload.reviewStage;
      if(!stage||!['PREPARING','WAIT_IMAGES','QUEUE_VIDEO','WAIT_VIDEO','REGENERATE'].includes(stage))throw conflict('This stage needs explicit inspection or a new approved plan.');
      if(stage==='WAIT_IMAGES'||stage==='PREPARING'||stage==='QUEUE_VIDEO'||stage==='REGENERATE'){
        const jobs=rows<{state:string}>(await tx.execute(sql`select state from local_image_jobs where org_id=${ctx.orgId} and id in (select jsonb_array_elements_text(${JSON.stringify(payload.assetIds)}::jsonb)::uuid)`));
        if(jobs.some(j=>['UNCERTAIN','FAILED','CANCELLED'].includes(j.state)))throw conflict('An image job has not been safely reconciled; do not replay it.');
      }
      if(stage==='WAIT_VIDEO'){
        const [job]=rows<{status:string}>(await tx.execute(sql`select status from generation_jobs where id=${p.jobId} and org_id=${ctx.orgId}`));
        if(!job||['FAILED','CANCELLED'].includes(job.status))throw conflict('Render outcome requires GPU review; cannot silently retry.');
      }
      state=stage;
    }
    await tx.execute(sql`update production_plans set state=${state},payload=${JSON.stringify(payload)}::jsonb,detail='Owner requested bounded recovery.',updated_at=now() where id=${id} and org_id=${ctx.orgId}`);
    await tx.execute(sql`update production_runs set planning_state='PLANNED',updated_at=now() where id=${p.runId} and org_id=${ctx.orgId}`);
    await runEvent(tx,ctx.orgId,p.runId,'PLAN_RECOVERY','Owner requested '+action+'.',p.jobId);
    await audit({...ctx,db:tx},'production.plan.recovery',{type:'production_run',id:p.runId},undefined,{planId:id,action});
    return {id,state};
  });
}
export async function runDueProductionPlans(db:Db,env:ServiceEnv){
  // Repeat only idempotent DB transitions. A paid review with uncertain outcome is never silently repeated.
  await db.execute(sql`update production_plans set state=case when state='QUALITY' then 'REVIEW' else state end,detail=case when state='QUALITY' then 'Quality worker interrupted; provider outcome uncertain. Review manually.' else detail end,payload=case when state='QUALITY' then payload||'{"reviewStage":"QUALITY"}'::jsonb else payload end,lease=null,lease_at=null,updated_at=now() where lease is not null and lease_at<now()-interval '12 minutes'`);
  await db.execute(sql`update production_plans p set state='STOPPED',detail='Run stopped by owner.',updated_at=now() from production_runs r where p.run_id=r.id and p.org_id=r.org_id and r.state='STOPPED' and p.lease is null and p.state not in ('PASSED','FAILED','REVIEW','STOPPED')`);
  const [p]=rows<Plan>(await db.execute(sql`select ${columns} from production_plans p join production_runs r on r.id=p.run_id and r.org_id=p.org_id join organizations o on o.id=p.org_id where p.state in ('PREPARING','WAIT_IMAGES','QUEUE_VIDEO','WAIT_VIDEO','QUALITY','REGENERATE') and p.lease is null and r.state='ACTIVE' and coalesce(o.settings->'productionAutomation'->(p.brand_id::text)->>'paused','false')<>'true' order by p.updated_at,p.id limit 1`));
  if(!p)return {advanced:0};
  const lease=randomUUID(),ctx=systemCtx({db,env},p.orgId);
  const claimed=rows(await db.execute(sql`update production_plans set lease=${lease},lease_at=now() where id=${p.id} and org_id=${p.orgId} and state=${p.state} and lease is null returning id`));
  if(!claimed.length)return {advanced:0};
  try{await advance(ctx,p,lease);}
  catch(e){await finish(ctx,p,lease,'REVIEW',redactSecrets(e instanceof Error?e.message:'Production stage failed.'),{payload:{...p.payload,reviewStage:p.state}});}
  return {advanced:1};
}
