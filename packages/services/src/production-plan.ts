import { randomUUID } from 'node:crypto';
import { sql, type Db } from '@creatoros/db';
import { redactSecrets } from '@creatoros/domain';
import { generateH3, type H3Form } from './h3';
import { queueProjectImage } from './ai';
import { queueLocalProjectImage } from './local-image';
import { importProjectGeneratedImage } from './gateway-media';
import { runEvent } from './production-run';
import { badRequest, conflict, notFound, systemCtx, type Ctx, type ServiceEnv } from './types';

const rows=<T>(r:unknown)=>(r as {rows:T[]}).rows;
export type AssetSpec={rootId:string;provider:'local'|'gemini';prompt:string;referenceFileIds:string[];width:number;height:number;slots:{segment:number;image:number}[]};
export type PlanInput={runId:string;form:H3Form;sourceEvidence:string;assets:AssetSpec[];acceptBillable:boolean};
type AssetState=AssetSpec&{importId:string;imageJobId?:string;assetId?:string;fileId?:string};
type PlanRow={id:string;orgId:string;runId:string;projectId:string;brandId:string;state:string;plan:PlanInput;assets:AssetState[];jobId:string|null;step:string|null;detail:string|null};
export function validatePlanSlots(input:PlanInput){
  const f=input.form;
  if(!f.projectId||!f.workerId||!f.prompt.trim()||!input.sourceEvidence.trim()||f.segments.length<1||f.segments.length>5||f.megapixels>1.5||f.segments.some(s=>!s.durationSec||s.durationSec>9||!s.prompt.trim())||f.segments.reduce((n,s)=>n+(s.durationSec??0),0)>30)throw badRequest('Plan needs project, worker, evidence, 1–5 prompted segments up to 9s each and 30s total.');
  if(input.assets.length>4)throw badRequest('At most four missing-image jobs per plan.');
  if(input.assets.some(a=>a.provider==='gemini')&&!input.acceptBillable)throw badRequest('Gemini requires explicit billable authorization.');
  const mapped=new Set<string>();
  for(const a of input.assets){
    if(!a.slots.length||!a.prompt.trim()||a.prompt.length>4000||!a.referenceFileIds.length||a.referenceFileIds.length>8||![a.width,a.height].every(n=>Number.isInteger(n)&&n>=256&&n<=2048&&n%8===0)||a.width*a.height>2097152)throw badRequest('Each asset needs reference IDs, dimensions, prompt and explicit target slots.');
    for(const s of a.slots){
      const key=s.segment+':'+s.image,slot=f.segments[s.segment]?.images[s.image];
      if(!slot||slot.fileId||slot.uploadName||slot.uploadWorkerId||mapped.has(key))throw badRequest('Missing image slots must exist, be empty and be mapped only once.');
      mapped.add(key);
    }
  }
  f.segments.forEach((s,si)=>{
    if(!s.images.length||s.images.some((im,ii)=>!im.fileId&&!mapped.has(si+':'+ii)))throw badRequest('Every segment image slot needs a verified file or an explicit generation dependency.');
  });
}
export function materializePlanForm(form:H3Form,assets:AssetState[]){
  const result=structuredClone(form);
  for(const a of assets){
    if(!a.fileId)throw conflict('Image dependency is not registered.');
    for(const slot of a.slots)result.segments[slot.segment]!.images[slot.image]!.fileId=a.fileId;
  }
  return result;
}
async function verifyMedia(ctx:Ctx,id:string|null|undefined,kind:string){
  if(id&&!rows(await ctx.db.execute(sql`select id from file_instances where org_id=${ctx.orgId} and id=${id} and file_type::text=${kind} and archived_at is null and availability='AVAILABLE'`)).length)throw badRequest('A planned '+kind+' library reference is unavailable.');
}
async function verifyForm(ctx:Ctx,f:H3Form){
  if(f.imageUploadName||f.imageUploadWorkerId)throw badRequest('Use library IDs, not worker filenames.');
  await verifyMedia(ctx,f.imageFileId,'IMAGE');
  for(const s of f.segments){
    if(s.audioUploadName||s.audioUploadWorkerId||s.videoUploadName||s.videoUploadWorkerId)throw badRequest('Use library IDs, not worker filenames.');
    await verifyMedia(ctx,s.audioFileId,'AUDIO');await verifyMedia(ctx,s.videoFileId,'VIDEO');
    for(const im of s.images){if(im.uploadName||im.uploadWorkerId)throw badRequest('Use library IDs, not worker filenames.');await verifyMedia(ctx,im.fileId,'IMAGE');}
  }
}
export async function saveProductionPlan(ctx:Ctx,input:PlanInput,requestId:string){
  validatePlanSlots(input);await verifyForm(ctx,input.form);
  const f=input.form;
  return ctx.db.transaction(async tx=>{
    const [run]=rows<{brandId:string;target:number;state:string}>(await tx.execute(sql`select brand_id as "brandId",target,state from production_runs where id=${input.runId} and org_id=${ctx.orgId} for update`));
    if(!run||run.state!=='ACTIVE')throw conflict('Run is not active.');
    if(!rows(await tx.execute(sql`select id from creative_projects where id=${f.projectId} and org_id=${ctx.orgId} and brand_id=${run.brandId} and deleted_at is null and stage in ('DRAFT','IN_PROGRESS')`)).length)throw badRequest('Choose a draft project belonging to this run creator.');
    if(!rows(await tx.execute(sql`select id from gpu_workers where id=${f.workerId} and org_id=${ctx.orgId} and enabled`)).length)throw badRequest('Choose an enabled H3 worker.');
    const [old]=rows<{id:string;state:string}>(await tx.execute(sql`select id,state from production_plans where org_id=${ctx.orgId} and run_id=${input.runId} and project_id=${f.projectId}`));
    if(old){if(old.id!==requestId)throw conflict('An immutable plan already exists for this run and project. Inspect its status.');return old;}
    const [count]=rows<{n:number}>(await tx.execute(sql`select count(*)::int as n from (select project_id from production_plans where org_id=${ctx.orgId} and run_id=${input.runId} union select project_id from generation_jobs where org_id=${ctx.orgId} and settings->>'productionRunId'=${input.runId}) p`));
    if((count?.n??0)>=run.target)throw conflict('Daily run already has its target number of plans.');
    for(const a of input.assets){
      if(!rows(await tx.execute(sql`select id from storage_roots where org_id=${ctx.orgId} and id=${a.rootId} and state='ACTIVE' and retired_at is null`)).length)throw badRequest('Choose an active indexed asset root.');
      for(const id of a.referenceFileIds)await verifyMedia({...ctx,db:tx},id,'IMAGE');
    }
    const assets=input.assets.map(a=>({...a,importId:randomUUID()}));
    await tx.execute(sql`insert into production_plans(id,org_id,run_id,project_id,brand_id,plan,assets,detail) values(${requestId},${ctx.orgId},${input.runId},${f.projectId},${run.brandId},${JSON.stringify(input)}::jsonb,${JSON.stringify(assets)}::jsonb,'Executable plan accepted.')`);
    await tx.execute(sql`update production_runs set planning_state='PLANNED',planning_detail='Executable plans accepted; worker will prepare assets and queue H3.',updated_at=now() where org_id=${ctx.orgId} and id=${input.runId}`);
    await runEvent(tx,ctx.orgId,input.runId,'PLAN_ACCEPTED','Saved executable plan '+requestId+'; '+assets.length+' missing image dependencies.');
    return {id:requestId,state:'WAITING'};
  });
}
export async function productionPlanStatus(ctx:Ctx,id:string){
  const [p]=rows<PlanRow>(await ctx.db.execute(sql`select id,run_id as "runId",project_id as "projectId",brand_id as "brandId",state,plan,assets,job_id as "jobId",step,detail from production_plans where org_id=${ctx.orgId} and id=${id}`));
  if(!p)throw notFound('Production plan');
  return p;
}
function aspect(width:number,height:number){
  const choices=[['16:9',16/9],['9:16',9/16],['1:1',1],['4:5',4/5],['3:2',3/2],['4:3',4/3],['21:9',21/9]] as const;
  return [...choices].sort((a,b)=>Math.abs(a[1]-width/height)-Math.abs(b[1]-width/height))[0]![0];
}
export async function runDueProductionPlans(db:Db,env:ServiceEnv){
  // Queue admission and H3 submission are idempotent. Scanner writes are not replayed after an uncertain lease.
  await db.execute(sql`update production_plans set state=case when step='IMPORT' then 'UNCERTAIN' else 'WAITING' end,detail=case when step='IMPORT' then 'Worker stopped during import; inspect original scanner destination and asset before retrying.' else 'Recovered interrupted idempotent stage.' end,lease=null,lease_at=null,updated_at=now() where state='WAITING' and lease is not null and lease_at<now()-interval '15 minutes'`);
  await db.execute(sql`update production_plans p set state='STOPPED',detail='Run stopped by owner.',updated_at=now() from production_runs r where p.run_id=r.id and p.org_id=r.org_id and r.state='STOPPED' and p.state='WAITING' and p.lease is null`);
  const lease=randomUUID();
  const [p]=rows<PlanRow>(await db.execute(sql`update production_plans set lease=${lease},lease_at=now(),step=null where id=(select p.id from production_plans p join production_runs r on r.id=p.run_id and r.org_id=p.org_id join organizations o on o.id=p.org_id where p.state='WAITING' and p.lease is null and r.state='ACTIVE' and coalesce(o.settings->'productionAutomation'->(r.brand_id::text)->>'paused','false')<>'true' order by p.updated_at,p.id limit 1 for update of p skip locked) returning id,org_id as "orgId",run_id as "runId",project_id as "projectId",brand_id as "brandId",state,plan,assets,job_id as "jobId",step,detail`));
  if(!p)return;
  const ctx=systemCtx({db,env},p.orgId);
  let step='WAIT',detail='Waiting for asset generation.',state='WAITING',jobId:string|null=null;
  const mark=async(s:string)=>{step=s;await db.execute(sql`update production_plans set step=${s},lease_at=now() where id=${p.id} and org_id=${p.orgId} and lease=${lease}`);};
  try{
    const a=p.assets.find(a=>!a.fileId);
    if(a){
      if(!a.imageJobId){
        const [existing]=rows<{id:string}>(await db.execute(sql`select id from ai_jobs where org_id=${p.orgId} and idempotency_key=${'plan:'+p.id+':'+a.importId}`));
        if(existing)a.imageJobId=existing.id;
        else if(a.provider==='gemini'&&rows(await db.execute(sql`select id from ai_jobs where org_id=${p.orgId} and status in ('QUEUED','RUNNING') and task like 'scene_image%' limit 1`)).length)detail='Waiting for the existing Gemini image job.';
        else{
          await mark('QUEUE_IMAGE');
          const common={projectId:p.projectId,prompt:a.prompt,referenceFileIds:a.referenceFileIds,idempotencyKey:'plan:'+p.id+':'+a.importId,runId:p.runId};
          const job=a.provider==='local'?await queueLocalProjectImage(ctx,{...common,width:a.width,height:a.height}):await queueProjectImage(ctx,{...common,aspect:aspect(a.width,a.height),acceptBillable:p.plan.acceptBillable});
          a.imageJobId=job.id;detail='Image job accepted: '+job.id;
        }
      }else{
        const [job]=rows<{status:string;error:string|null}>(await db.execute(sql`select status,error from ai_jobs where org_id=${p.orgId} and id=${a.imageJobId} and target_type='creative_project' and target_id=${p.projectId}`));
        if(!job||job.status==='FAILED')throw conflict(job?.error??'Image job is missing.');
        if(job.status==='COMPLETED'){
          const [asset]=rows<{id:string}>(await db.execute(sql`select id from ai_assets where org_id=${p.orgId} and job_id=${a.imageJobId} and project_id=${p.projectId} and path like 'ai/%' order by created_at,id limit 1`));
          if(!asset)throw conflict('Completed image job has no saved asset.');
          a.assetId=asset.id;
          if(!rows(await db.execute(sql`select r.id from storage_roots r join devices d on d.id=r.device_id and d.org_id=r.org_id where r.id=${a.rootId} and r.org_id=${p.orgId} and r.state='ACTIVE' and r.retired_at is null and d.state='ONLINE'`)).length)detail='Waiting for the selected image storage scanner.';
          else{
            // Persist the exact asset and import step before the external write.
            await db.execute(sql`update production_plans set assets=${JSON.stringify(p.assets)}::jsonb,step='IMPORT',lease_at=now() where id=${p.id} and org_id=${p.orgId} and lease=${lease}`);step='IMPORT';
            const imported=await importProjectGeneratedImage(ctx,{assetId:a.assetId,rootId:a.rootId,projectId:p.projectId,brandId:p.brandId},a.importId);
            a.fileId=imported.fileId;detail='Generated dependency registered: '+a.fileId;
          }
        }else detail='Image job '+a.imageJobId+' is '+job.status.toLowerCase()+'.';
      }
    }else{
      await mark('SUBMIT_H3');
      const f=materializePlanForm(p.plan.form,p.assets);await verifyForm(ctx,f);
      const generated=await generateH3(ctx,f,{runId:p.runId,sourceEvidence:p.plan.sourceEvidence,skipDraft:true,serialDispatch:true});
      state='SUBMITTED';jobId=generated.job.id;detail='H3 job accepted: '+jobId;
    }
  }catch(e){
    state=step==='IMPORT'?'UNCERTAIN':'BLOCKED';
    detail=redactSecrets(e instanceof Error?e.message:String(e)).slice(0,4000);
  }
  await db.transaction(async tx=>{
    const changed=rows(await tx.execute(sql`update production_plans set state=${state},assets=${JSON.stringify(p.assets)}::jsonb,job_id=${jobId},detail=${detail},step=${step},lease=null,lease_at=null,updated_at=now() where org_id=${p.orgId} and id=${p.id} and lease=${lease} returning id`));
    if(changed.length&&detail!==p.detail)await runEvent(tx,p.orgId,p.runId,'PLAN_'+state,detail,jobId);
  });
}
