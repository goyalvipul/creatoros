import {z} from 'zod';
import {sql} from '@creatoros/db';
import {createHash} from 'node:crypto';
import {qualityReportSchema,qualityDecision,inspectTechnicalVideo,type QualityRequirements,type SemanticQuality} from './production-quality';
import {runEvent,runPrefs,runPlatforms,setAutomatedProjectStage} from './production-run';
import {readSocialCover} from './social-cover';
import {audit} from './audit';
import {badRequest,conflict,notFound,type Ctx} from './types';

const rows=<T>(r:unknown)=>(r as {rows:T[]}).rows;
export const productionFinalizeSchema=z.object({jobId:z.uuid(),fileId:z.uuid()}).strict();
export const productionQualityReportSchema=productionFinalizeSchema.extend({
  assessment:qualityReportSchema,
  evidence:z.object({frameSeconds:z.array(z.number().min(0).max(45)).min(1).max(120),continuousMotion:z.boolean(),audioHeard:z.boolean(),lipSyncObserved:z.boolean()}).strict(),
  requireAudio:z.boolean(),requireLipSync:z.boolean(),requirePhysicalAccuracy:z.boolean(),
}).strict();
type Target=z.infer<typeof productionFinalizeSchema>;
type Report=z.infer<typeof productionQualityReportSchema>;
type Stored={requirements?:QualityRequirements;fileId:string;versionId:string;size:number;mtime:string;verdict:string;technical:unknown;semantic:SemanticQuality;evidence:Report['evidence'];corrections:string[]};
type Output={jobId:string;projectId:string;brandId:string;stage:string;status:string;settings:Record<string,unknown>;runId:string|null;runState:string|null;fileId:string;versionId:string;size:number;mtime:string;planId:string|null;planState:string|null;planPayload:Record<string,unknown>|null};
async function output(ctx:Ctx,target:Target,lock=false){
  const [o]=rows<Output>(await ctx.db.execute(sql`select j.id as "jobId",p.id as "projectId",p.brand_id as "brandId",p.stage,j.status,j.settings,
    j.settings->>'productionRunId' as "runId",r.state as "runState",f.id as "fileId",o.asset_version_id as "versionId",f.size::float8 as size,f.mtime::text as mtime,
    pl.id as "planId",pl.state as "planState",pl.payload as "planPayload"
    from generation_jobs j join creative_projects p on p.id=j.project_id and p.org_id=j.org_id
    join generation_outputs o on o.job_id=j.id and o.org_id=j.org_id and o.output_role='final'
    join file_instances f on f.id=o.file_instance_id and f.org_id=o.org_id
    left join production_runs r on r.id::text=j.settings->>'productionRunId' and r.org_id=j.org_id
    left join production_plans pl on pl.id::text=j.settings->>'productionPlanId' and pl.org_id=j.org_id and pl.job_id=j.id
    where j.org_id=${ctx.orgId} and j.id=${target.jobId} and f.id=${target.fileId} and p.deleted_at is null and p.brand_id is not null
    and f.archived_at is null and f.availability='AVAILABLE' and f.file_type='VIDEO' and o.asset_version_id is not null
    and j.provider='comfyui-h3' and j.status='SUCCEEDED'
    and coalesce(j.settings->>'productionSuperseded','false')<>'true'
    and (j.settings->>'productionPlanId' is null or pl.id is not null)
    and not exists(select 1 from generation_jobs newer where newer.org_id=j.org_id and newer.project_id=j.project_id and newer.provider=j.provider and newer.created_at>j.created_at and newer.status in ('QUEUED','RUNNING','SUCCEEDED') and coalesce(newer.settings->>'productionSuperseded','false')<>'true')
    ${lock?sql`for update of j,p`:sql``}`));
  if(!o)throw notFound('Current successful H3 output');
  return o;
}
function requireActive(o:Output){
  if(o.settings.dispatchPaused===true||o.settings.productionStopped===true||(o.runId&&o.runState!=='ACTIVE'))throw conflict('Production is paused or stopped.');
  if(!['DRAFT','IN_PROGRESS','READY'].includes(o.stage))throw conflict('Project is not an editable production.');
}
function requirements(o:Output,p:Report):QualityRequirements {
  const segments=o.settings.segments as {durationSec?:number;audioFileId?:string;audioUploadName?:string}[]|undefined;
  const duration=(segments??[]).reduce((n,s)=>n+(s.durationSec??0),0);
  const aspectRatio=String(o.settings.aspectRatio??'');
  if(duration<=0||duration>30||!/^\d+:\d+/.test(aspectRatio))throw badRequest('Original render requirements are unavailable.');
  const plan=o.planPayload;
  const previous=o.settings.qualityReport as (Stored&{requirements?:QualityRequirements})|undefined;
  return {duration,aspectRatio,requireAudio:previous?.requirements?.requireAudio===true||p.requireAudio||p.requireLipSync||plan?.requireAudio===true||plan?.requireLipSync===true||!!segments?.some(s=>s.audioFileId||s.audioUploadName),requireLipSync:previous?.requirements?.requireLipSync===true||p.requireLipSync||plan?.requireLipSync===true,requirePhysicalAccuracy:previous?.requirements?.requirePhysicalAccuracy===true||p.requirePhysicalAccuracy||plan?.requirePhysicalAccuracy===true};
}
export function constrainEvidence(report:Report,required:QualityRequirements):SemanticQuality {
  const checks=report.assessment.checks.map(c=>{
    if(c.status!=='PASS')return c;
    const missing=(c.criterion==='motion'&&!report.evidence.continuousMotion)||(c.criterion==='audio'&&!report.evidence.audioHeard)||(c.criterion==='lipSync'&&(!report.evidence.lipSyncObserved||!report.evidence.audioHeard||!report.evidence.continuousMotion))||(c.criterion==='physicalAccuracy'&&required.requirePhysicalAccuracy&&!report.evidence.continuousMotion);
    return missing?{...c,status:'UNCERTAIN' as const,evidence:'Required modality not inspected: '+c.evidence}:c;
  });
  return {checks};
}
function matches(o:Output,r:Stored|undefined){return !!r&&r.fileId===o.fileId&&r.versionId===o.versionId&&r.size===o.size&&r.mtime===o.mtime;}
export async function submitChatGPTQualityReport(ctx:Ctx,input:Report){
  const p=productionQualityReportSchema.parse(input);
  const initial=await output(ctx,p);requireActive(initial);
  if((await runPrefs(ctx))[initial.brandId]?.paused)throw conflict('Creator production is paused.');
  const req=requirements(initial,p);
  if(p.evidence.frameSeconds.some(s=>s>req.duration+0.75))throw badRequest('Frame evidence exceeds the planned duration.');
  const semantic=constrainEvidence(p,req);
  const technical=await inspectTechnicalVideo(ctx,p.fileId,req);
  const decision=qualityDecision(technical,semantic,req);
  const report:Stored={requirements:req,fileId:p.fileId,versionId:initial.versionId,size:initial.size,mtime:initial.mtime,technical,semantic,evidence:p.evidence,...decision};
  return ctx.db.transaction(async tx=>{
    const scoped={...ctx,db:tx};
    const o=await output(scoped,p,true);requireActive(o);
    if(!matches(o,report))throw conflict('Output changed during review.');
    if(o.stage==='READY'&&decision.verdict!=='PASS')throw conflict('Reopen the project for review before replacing a finalized quality report.');
    if(o.settings.postProduction&&((o.settings.postProduction as {lease?:string}).lease))throw conflict('Another post-production worker is active.');
    if(o.planId){
      if(!['QUALITY','REVIEW','PASSED'].includes(o.planState??''))throw conflict('Plan is not awaiting assessment.');
      const changed=rows(await tx.execute(sql`update production_plans set state=${decision.verdict==='PASS'?'PASSED':'REVIEW'},quality=${JSON.stringify(report)}::jsonb,detail=${decision.verdict==='PASS'?'ChatGPT quality report passed.':'ChatGPT quality report needs review.'},payload=payload||'{"reviewStage":"QUALITY"}'::jsonb,updated_at=now() where id=${o.planId} and org_id=${ctx.orgId} and job_id=${o.jobId} and lease is null and state in ('QUALITY','REVIEW','PASSED') returning id`));
      if(!changed.length)throw conflict('Plan changed; check its status.');
    }
    const phase=decision.verdict==='PASS'?'AWAITING_PUBLISHING_PACKAGE':'AWAITING_QUALITY_REVIEW';
    await tx.execute(sql`update generation_jobs set settings=settings||${JSON.stringify({creativeOwner:'chatgpt',qualityReport:report,productionQualityPassed:decision.verdict==='PASS',postProduction:{phase,fileId:p.fileId,detail:decision.verdict==='PASS'?'Verified report; awaiting platform drafts and covers.':'Quality review is incomplete or failed.'}})}::jsonb,updated_at=now() where id=${o.jobId} and org_id=${ctx.orgId}`);
    await runEvent(tx,ctx.orgId,o.runId,phase,'ChatGPT submitted quality evidence: '+decision.verdict,o.jobId);
    await audit(scoped,'production.quality.report',{type:'generation_job',id:o.jobId},undefined,{fileId:p.fileId,verdict:decision.verdict});
    return {jobId:o.jobId,fileId:p.fileId,...decision,technical,phase};
  });
}
async function inspectReadiness(ctx:Ctx,o:Output){
  const missing:string[]=[];
  if(o.settings.productionQualityPassed!==true||!matches(o,o.settings.qualityReport as Stored|undefined)||(o.settings.qualityReport as Stored|undefined)?.verdict!=='PASS')missing.push('QUALITY_REPORT_PASS');
  if(o.settings.dispatchPaused===true||o.settings.productionStopped===true||(o.runId&&o.runState!=='ACTIVE')||(await runPrefs(ctx))[o.brandId]?.paused)missing.push('PRODUCTION_PAUSED');
  if(!['DRAFT','IN_PROGRESS','READY'].includes(o.stage))missing.push('PROJECT_NOT_EDITABLE');
  if(rows(await ctx.db.execute(sql`select id from generation_jobs where org_id=${ctx.orgId} and project_id=${o.projectId} and status in ('QUEUED','RUNNING') limit 1`)).length)missing.push('ACTIVE_RENDER');
  const items=rows<{id:string}>(await ctx.db.execute(sql`select i.id from publish_items i join distribution_variants v on v.id=i.variant_id and v.org_id=i.org_id where i.org_id=${ctx.orgId} and v.project_id=${o.projectId} and i.file_instance_id=${o.fileId}`));
  if(items.length!==1)missing.push('EXACT_PUBLISHING_ITEM');
  const itemId=items.length===1?items[0]!.id:null;
  const accounts=rows<{id:string;platform:string;title:string|null;caption:string|null;hashtags:string[]|null;state:string|null;aiUse:string|null}>(await ctx.db.execute(sql`select a.id,a.platform::text as platform,d.title,d.caption,d.hashtags,d.upload_state as state,d.ai_use as "aiUse"
    from social_accounts a join channels c on c.id=a.channel_id and c.org_id=a.org_id
    left join publish_drafts d on d.social_account_id=a.id and d.org_id=a.org_id and d.item_id=${itemId}
    where a.org_id=${ctx.orgId} and c.brand_id=${o.brandId} and a.active and a.deleted_at is null and c.deleted_at is null and a.platform::text in ('youtube','instagram','facebook','tiktok','threads','x') order by a.id`));
  if(!accounts.length)missing.push('ELIGIBLE_ACCOUNTS');
  const results=[];
  for(const a of accounts){
    const draft=a.state==='DRAFT'&&!!a.title?.trim()&&!!a.caption?.trim()&&!!a.hashtags?.length&&a.aiUse==='YES';
    const cover=itemId?await readSocialCover(ctx,ctx.orgId,itemId,a.id):null;
    const coverSha256=cover?.bytes.length?createHash('sha256').update(cover.bytes).digest('hex'):null;
    if(!draft)missing.push('DRAFT:'+a.id);
    if(!coverSha256)missing.push('COVER:'+a.id);
    results.push({accountId:a.id,platform:a.platform,draftVerified:draft,coverSha256});
  }
  return {jobId:o.jobId,fileId:o.fileId,projectId:o.projectId,itemId,stage:o.stage,ready:missing.length===0,missing,accounts:results,unconnectedPlatforms:runPlatforms.filter(p=>!accounts.some(a=>a.platform===p))};
}
export async function productionReadiness(ctx:Ctx,p:Target){return inspectReadiness(ctx,await output(ctx,productionFinalizeSchema.parse(p)));}
export async function finalizeChatGPTProduction(ctx:Ctx,p:Target){
  return ctx.db.transaction(async tx=>{
    const scoped={...ctx,db:tx};
    const o=await output(scoped,productionFinalizeSchema.parse(p),true);
    const status=await inspectReadiness(scoped,o);
    if(!status.ready)return status;
    await setAutomatedProjectStage(tx,ctx.orgId,o.projectId,'READY','Verified ChatGPT quality report, indexed output, connected drafts and saved covers; human review before publication.');
    const [project]=rows<{stage:string}>(await tx.execute(sql`select stage from creative_projects where id=${o.projectId} and org_id=${ctx.orgId}`));
    if(project?.stage!=='READY')throw conflict('Project stage changed before finalization.');
    await tx.execute(sql`update generation_jobs set settings=settings||${JSON.stringify({creativeOwner:'chatgpt',postProduction:{phase:'READY',fileId:o.fileId,itemId:status.itemId,prefilled:status.accounts.map(a=>a.accountId),covers:status.accounts.map(a=>a.platform),detail:'Verified ChatGPT publishing package.',verification:status.accounts}})}::jsonb,updated_at=now() where id=${o.jobId} and org_id=${ctx.orgId}`);
    await runEvent(tx,ctx.orgId,o.runId,'READY','ChatGPT quality, drafts and covers verified.',o.jobId);
    await audit(scoped,'production.finalize',{type:'generation_job',id:o.jobId},undefined,{fileId:o.fileId,itemId:status.itemId});
    return {...status,stage:'READY'};
  });
}
