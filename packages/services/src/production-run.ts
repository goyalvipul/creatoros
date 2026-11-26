import {sql,type Db,type Executor} from '@creatoros/db';
import {audit} from './audit';
import {notify} from './notifications';
import {badRequest,conflict,notFound,type Ctx,type ServiceEnv} from './types';

const rows=<T>(r:unknown)=>(r as {rows:T[]}).rows;
export type RunState='ACTIVE'|'PAUSED'|'STOPPED';
export type Run={id:string;brandId:string;localDay:string;target:number;state:RunState;planningState:string;planningDetail:string|null;createdAt:string;updatedAt:string};
export const runPlatforms=['youtube','instagram','facebook','tiktok','threads','x'] as const;
export async function runEvent(db:Executor,orgId:string,runId:string|null|undefined,stage:string,detail:string,jobId?:string|null){
  if(!runId)return;
  await db.execute(sql`insert into production_run_events(org_id,run_id,job_id,stage,detail)
    select ${orgId},id,${jobId??null},${stage.slice(0,80)},${detail.slice(0,4000)} from production_runs where id=${runId} and org_id=${orgId}`);
}
export async function runPrefs(ctx:Ctx){
  const [row]=rows<{settings:Record<string,unknown>}>(await ctx.db.execute(sql`select settings from organizations where id=${ctx.orgId}`));
  const value=row?.settings?.productionAutomation;
  return (value&&typeof value==='object'&&!Array.isArray(value)?value:{}) as Record<string,{paused?:boolean;billablePostprocess?:boolean}>;
}
export async function setProductionPreference(ctx:Ctx,brandId:string,patch:{paused?:boolean;billablePostprocess?:boolean}){
  await ctx.db.transaction(async tx=>{
    const [brand]=rows(await tx.execute(sql`select id from brands where org_id=${ctx.orgId} and id=${brandId} and active and deleted_at is null`));
    if(!brand)throw notFound('Creator');
    const [org]=rows<{settings:Record<string,unknown>}>(await tx.execute(sql`select settings from organizations where id=${ctx.orgId} for update`));
    const old=(org?.settings?.productionAutomation??{}) as Record<string,Record<string,unknown>>;
    const next={...old,[brandId]:{...old[brandId],...patch}};
    await tx.execute(sql`update organizations set settings=settings||${JSON.stringify({productionAutomation:next})}::jsonb,updated_at=now() where id=${ctx.orgId}`);
    await audit({...ctx,db:tx},'production.preferences',{type:'brand',id:brandId},undefined,patch);
  });
  return {saved:true};
}
export async function startProductionRun(ctx:Ctx,input:{brandId:string;localDay:string;target:number}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.localDay)||!Number.isInteger(input.target)||input.target<1||input.target>2)throw badRequest('Invalid production date or target.');
  const [today]=rows<{day:string}>(await ctx.db.execute(sql`select to_char(now() at time zone 'America/Vancouver','YYYY-MM-DD') as day`));
  if(input.localDay!==today?.day)throw badRequest('Start a run for the current Vancouver day.');
  if((await runPrefs(ctx))[input.brandId]?.paused)throw conflict('Production is paused for this creator.');
  return ctx.db.transaction(async tx=>{
    if(!rows(await tx.execute(sql`select id from brands where id=${input.brandId} and org_id=${ctx.orgId} and active and deleted_at is null`)).length)throw notFound('Creator');
    const [created]=rows<{id:string}>(await tx.execute(sql`insert into production_runs(org_id,brand_id,local_day,target) values(${ctx.orgId},${input.brandId},${input.localDay}::date,${input.target}) on conflict(org_id,brand_id,local_day) do nothing returning id`));
    const [run]=rows<Run>(await tx.execute(sql`select id,brand_id as "brandId",local_day::text as "localDay",target,state,planning_state as "planningState",planning_detail as "planningDetail",created_at as "createdAt",updated_at as "updatedAt" from production_runs where org_id=${ctx.orgId} and brand_id=${input.brandId} and local_day=${input.localDay}::date`));
    if(!run||run.state!=='ACTIVE')throw conflict('This daily run is paused or stopped.');
    if(created)await runEvent(tx,ctx.orgId,run.id,'RESEARCHING','Daily production run registered.');
    return run;
  });
}
export async function recordProductionPlanning(ctx:Ctx,input:{runId:string;stage:'RESEARCHING'|'PLANNED'|'BLOCKED'|'FAILED';detail:string}){
  return ctx.db.transaction(async tx=>{
    const [r]=rows<{id:string}>(await tx.execute(sql`update production_runs set planning_state=${input.stage},planning_detail=${input.detail.slice(0,4000)},updated_at=now() where id=${input.runId} and org_id=${ctx.orgId} and state='ACTIVE' returning id`));
    if(!r)throw conflict('Run is missing, paused or stopped.');
    await runEvent(tx,ctx.orgId,r.id,input.stage,input.detail);
    return {saved:true};
  });
}
export async function assertRunSubmission(ctx:Ctx,runId:string,projectId:string){
  const [r]=rows<{brandId:string;state:string;target:number;planningState:string}>(await ctx.db.execute(sql`select brand_id as "brandId",state,target,planning_state as "planningState" from production_runs where id=${runId} and org_id=${ctx.orgId} for update`));
  if(!r||r.state!=='ACTIVE'||r.planningState!=='PLANNED')throw conflict('Run must be active and have a recorded production plan.');
  if((await runPrefs(ctx))[r.brandId]?.paused)throw conflict('Creator production is paused.');
  if(!rows(await ctx.db.execute(sql`select id from creative_projects where id=${projectId} and org_id=${ctx.orgId} and brand_id=${r.brandId} and deleted_at is null and stage in ('DRAFT','IN_PROGRESS')`)).length)throw badRequest('Choose a draft project belonging to this run creator.');
  const [existing]=rows<{id:string;status:string}>(await ctx.db.execute(sql`select id,status from generation_jobs where org_id=${ctx.orgId} and provider='comfyui-h3' and project_id=${projectId} and settings->>'productionRunId'=${runId}`));
  if(existing)return existing;
  const [n]=rows<{n:number}>(await ctx.db.execute(sql`select count(*)::int as n from generation_jobs where org_id=${ctx.orgId} and settings->>'productionRunId'=${runId}`));
  if((n?.n??0)>=r.target)throw conflict('Daily run already has its target number of videos.');
  return null;
}
export async function setAutomatedProjectStage(db:Executor,orgId:string,projectId:string|null,stage:'IN_PROGRESS'|'READY',reason:string){
  if(!projectId)return;
  // Automation READY means verified post-production. Leave manual checklist items untouched; never regress published/archived projects.
  const [p]=rows<{stage:string}>(await db.execute(sql`select stage from creative_projects where org_id=${orgId} and id=${projectId} and deleted_at is null for update`));
  if(!p||p.stage===stage||!['DRAFT','IN_PROGRESS'].includes(p.stage))return;
  if(stage==='READY'&&rows(await db.execute(sql`select id from generation_jobs where org_id=${orgId} and project_id=${projectId} and status in ('QUEUED','RUNNING') limit 1`)).length)return;
  await db.execute(sql`update creative_projects set stage=${stage}::project_stage,updated_at=now() where org_id=${orgId} and id=${projectId}`);
  await db.execute(sql`insert into project_status_events(org_id,project_id,from_stage,to_stage,source,reason) values(${orgId},${projectId},${p.stage}::project_stage,${stage}::project_stage,'production_automation',${reason})`);
}
export async function productionRunBoard(ctx:Ctx,runId?:string){
  const runs=rows<Run&{brandName:string}>(await ctx.db.execute(sql`select r.id,r.brand_id as "brandId",b.name as "brandName",r.local_day::text as "localDay",r.target,r.state,r.planning_state as "planningState",r.planning_detail as "planningDetail",r.created_at as "createdAt",r.updated_at as "updatedAt" from production_runs r join brands b on b.id=r.brand_id and b.org_id=r.org_id where r.org_id=${ctx.orgId} ${runId?sql`and r.id=${runId}`:sql``} order by r.local_day desc,r.created_at desc limit 30`));
  if(runId&&!runs.length)throw notFound('Production run');
  const jobs=rows<Record<string,unknown>>(await ctx.db.execute(sql`select j.id,j.project_id as "projectId",p.title,p.brand_id as "brandId",p.stage,j.status,j.error,j.created_at as "createdAt",j.started_at as "startedAt",j.finished_at as "finishedAt",j.settings->>'workerLabel' as worker,j.settings->>'productionRunId' as "runId",j.settings->'progress' as progress,j.settings->>'outputScanStatus' as "scanStatus",j.settings->'postProduction' as post,${runId?sql`j.settings->>'sourceEvidence' as "sourceEvidence",j.settings->'segments' as segments,`:sql``}coalesce(j.settings->>'dispatchPaused','false')='true' as paused
    from generation_jobs j left join creative_projects p on p.id=j.project_id and p.org_id=j.org_id where j.org_id=${ctx.orgId} and j.provider='comfyui-h3' and j.project_id is not null
    ${runId?sql`and j.settings->>'productionRunId'=${runId}`:sql`and j.created_at>now()-interval '30 days'`} order by j.created_at desc limit 100`));
  const events=rows<Record<string,unknown>>(await ctx.db.execute(sql`select e.id,e.run_id as "runId",e.job_id as "jobId",e.stage,e.detail,e.created_at as "createdAt" from production_run_events e where e.org_id=${ctx.orgId} ${runId?sql`and e.run_id=${runId}`:sql``} order by e.id desc limit 300`));
  const brands=rows<{id:string;name:string}>(await ctx.db.execute(sql`select id,name from brands where org_id=${ctx.orgId} and active and deleted_at is null order by name`));
  return {runs,jobs,events,brands,preferences:await runPrefs(ctx)};
}
export async function controlProductionRun(ctx:Ctx,id:string,action:'pause'|'resume'|'stop'){
  return ctx.db.transaction(async tx=>{
    const [r]=rows<{state:RunState}>(await tx.execute(sql`select state from production_runs where org_id=${ctx.orgId} and id=${id} for update`));
    if(!r)throw notFound('Run');
    if(r.state==='STOPPED')throw conflict('A stopped run cannot be resumed. Existing completed media stays available.');
    const state=action==='pause'?'PAUSED':action==='resume'?'ACTIVE':'STOPPED';
    await tx.execute(sql`update production_runs set state=${state},updated_at=now() where id=${id} and org_id=${ctx.orgId}`);
    if(action==='stop')await tx.execute(sql`update generation_jobs set status='CANCELLED',error='Stopped before dispatch by owner',finished_at=now(),updated_at=now() where org_id=${ctx.orgId} and settings->>'productionRunId'=${id} and status='QUEUED'`);
    await runEvent(tx,ctx.orgId,id,state,action==='stop'?'Stopped queued work and future stages; active render/provider calls are not forcibly interrupted.':'Owner '+action+' requested.');
    await audit({...ctx,db:tx},'production.run.'+action,{type:'production_run',id});
    return {state};
  });
}


export async function reconcileProductionRuns(db:Db,_env:ServiceEnv){
  await db.execute(sql`insert into production_run_events(org_id,run_id,job_id,stage,detail) select j.org_id,r.id,j.id,j.status::text,coalesce(j.error,'Render '+lower(j.status::text)) from generation_jobs j join production_runs r on r.id::text=j.settings->>'productionRunId' and r.org_id=j.org_id where j.status in ('FAILED','CANCELLED') and not exists(select 1 from production_run_events e where e.run_id=r.id and e.job_id=j.id and e.stage=j.status::text)`);
  const stale=rows<{id:string;orgId:string}>(await db.execute(sql`
    update production_runs r set planning_state='BLOCKED',planning_detail='Planner stopped reporting before submitting the target videos. Resume the existing ChatGPT automation to finish the plan.',updated_at=now()
    where r.state='ACTIVE' and r.planning_state in ('RESEARCHING','PLANNED') and r.updated_at<now()-interval '30 minutes'
      and (select count(*) from generation_jobs j where j.org_id=r.org_id and j.settings->>'productionRunId'=r.id::text)<r.target
    returning id,org_id as "orgId"`));
  for(const r of stale)await runEvent(db,r.orgId,r.id,'BLOCKED','Planning or submission stopped before the daily target was queued.');
  const runs=rows<{id:string;orgId:string;target:number;brandName:string;ready:number;failed:number}>(await db.execute(sql`select r.id,r.org_id as "orgId",r.target,b.name as "brandName",
    (select count(*)::int from generation_jobs j where j.org_id=r.org_id and j.settings->>'productionRunId'=r.id::text and j.settings->'postProduction'->>'phase'='READY') as ready,
    (select count(*)::int from generation_jobs j where j.org_id=r.org_id and j.settings->>'productionRunId'=r.id::text and (j.status='FAILED' or j.settings->'postProduction'->>'phase'='FAILED')) as failed
    from production_runs r join brands b on b.id=r.brand_id and b.org_id=r.org_id where r.state='ACTIVE' and r.created_at>now()-interval '30 days'`));
  for(const r of runs){
    if(r.ready>=r.target)await notify(db,{orgId:r.orgId,type:'production.ready',dedupeKey:'production.run.ready:'+r.id,title:r.brandName+' daily production ready',body:r.target+' videos ready for review. Nothing was published or scheduled.',severity:'INFO',deepLink:'/today',sourceType:'production_run',sourceId:r.id}).catch(()=>undefined);
    if(r.failed)await notify(db,{orgId:r.orgId,type:'production.failed',dedupeKey:'production.run.failed:'+r.id,title:r.brandName+' production needs attention',body:r.failed+' video job(s) failed. Review the run log.',severity:'WARNING',deepLink:'/today',sourceType:'production_run',sourceId:r.id}).catch(()=>undefined);
  }
}
