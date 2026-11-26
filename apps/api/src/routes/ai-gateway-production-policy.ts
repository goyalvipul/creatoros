import { z } from 'zod';
import { sql, type Executor } from '@creatoros/db';
import { conflict, forbidden, type Ctx } from '@creatoros/services';
import { h3Form } from './ai-gateway-forms';

export const productionPolicySchema=z.object({
  brandId:z.uuid(),rootId:z.uuid(),workerIds:z.array(z.uuid()).min(1).max(2),
  dailyVideos:z.number().int().min(1).max(2),
}).strict();
export type ProductionPolicy=z.infer<typeof productionPolicySchema>;
const rows=<T>(r:unknown)=>(r as {rows:T[]}).rows;
const quotas:Record<string,number>={'projects.create':2,'projects.update':8,'scenes.upsert':4,'media.uploadImage':24,'media.uploadAudio':4,'generation.h3':2,'publishing.draft':10};
export const productionOperations=Object.keys(quotas);

export async function validatePolicy(ctx:{orgId:string;db:Executor},p:ProductionPolicy){
  if(!rows(await ctx.db.execute(sql`select id from brands where org_id=${ctx.orgId} and id=${p.brandId} and active and deleted_at is null`)).length)throw forbidden('Choose an active creator.');
  if(!rows(await ctx.db.execute(sql`select id from storage_roots where org_id=${ctx.orgId} and id=${p.rootId} and state='ACTIVE' and retired_at is null`)).length)throw forbidden('Choose an indexed storage root.');
  if(new Set(p.workerIds).size!==p.workerIds.length)throw forbidden('Choose distinct GPU workers.');
  for(const id of p.workerIds)if(!rows(await ctx.db.execute(sql`select id from gpu_workers where org_id=${ctx.orgId} and id=${id} and enabled`)).length)throw forbidden('Choose an enabled worker.');
}

/** Called while the connection row is locked; quotas count claimed attempts, including failures. */
export async function authorizeProduction(ctx:Ctx,p:ProductionPolicy,operation:string,input:unknown){
  if(!Object.hasOwn(quotas,operation))return false;
  const v=input as Record<string,unknown>;
  const project=async(id:unknown)=>typeof id==='string'&&rows(await ctx.db.execute(sql`select id from creative_projects where id=${id} and org_id=${ctx.orgId} and brand_id=${p.brandId} and deleted_at is null and stage='DRAFT'`)).length>0;
  let matches=false;
  if(operation==='projects.create')matches=v.brandId===p.brandId;
  else if(operation==='projects.update')matches=await project(v.id);
  else if(operation==='scenes.upsert')matches=await project(v.projectId);
  else if(operation==='media.uploadImage'||operation==='media.uploadAudio')matches=v.brandId===p.brandId&&v.rootId===p.rootId&&(!v.projectId||await project(v.projectId));
  else if(operation==='generation.h3'){
    const f=h3Form.parse(input);
    matches=await project(f.projectId)&&!!f.workerId&&p.workerIds.includes(f.workerId);
    if(matches){
      if(!/^9:16(?:$|\s|\()/.test(f.aspectRatio)||f.megapixels>1||f.segments.length<1||f.segments.length>5||f.segments.some(s=>!s.durationSec||s.durationSec>9||s.videoFileId||s.videoUploadName||s.videoUploadWorkerId||!['ref','i2v'].includes(s.taskMode)||s.audioUseSec!=null&&s.audioUseSec>9||s.audioFileId&&!s.audioTrim)||f.segments.reduce((a,s)=>a+(s.durationSec??0),0)>30)throw forbidden('Trusted H3 is limited to 9:16, 1 MP, 1–5 segments, 9 seconds per segment and 30 seconds total, with no video references and trimmed audio only.');
      // Every selected file must be linked to this creator; legacy untagged files need owner review.
      const refs=[f.imageFileId,...f.segments.flatMap(s=>[s.audioFileId,...s.images.map(i=>i.fileId)])].filter((id):id is string=>!!id);
      for(const id of new Set(refs)){
        const [r]=rows<{ok:boolean}>(await ctx.db.execute(sql`select exists(select 1 from file_instances f join asset_file_links l on l.file_instance_id=f.id and l.org_id=f.org_id join asset_versions v on v.id=l.asset_version_id and v.org_id=l.org_id join logical_assets a on a.id=v.asset_id and a.org_id=v.org_id where f.id=${id} and f.org_id=${ctx.orgId} and f.archived_at is null and f.availability='AVAILABLE' and a.brand_id=${p.brandId} and not a.is_archived) as ok`));
        if(!r?.ok)throw forbidden('Trusted generation requires creator-linked available media.');
      }
    }
  }else if(operation==='publishing.draft'){
    matches=rows(await ctx.db.execute(sql`select i.id from publish_items i join distribution_variants v on v.id=i.variant_id and v.org_id=i.org_id join creative_projects p on p.id=v.project_id and p.org_id=v.org_id join social_accounts a on a.id=${v.socialAccountId} and a.org_id=i.org_id join channels c on c.id=a.channel_id and c.org_id=a.org_id where i.id=${v.itemId} and i.org_id=${ctx.orgId} and p.brand_id=${p.brandId} and p.deleted_at is null and c.brand_id=p.brand_id and c.deleted_at is null and a.active and a.deleted_at is null`)).length>0;
  }
  if(!matches)return false;
  await validatePolicy(ctx,p);
  const cap=operation==='generation.h3'||operation==='projects.create'?p.dailyVideos:quotas[operation]!;
  const [count]=rows<{n:number}>(await ctx.db.execute(sql`select count(*)::int as n from ai_gateway_requests where org_id=${ctx.orgId} and policy_authorized and operation=${operation} and created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver'`));
  if((count?.n??0)>=cap)throw conflict('Daily trusted production limit reached.');
  return true;
}
