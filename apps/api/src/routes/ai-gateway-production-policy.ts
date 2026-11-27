import { z } from 'zod';
import { sql, type Executor } from '@creatoros/db';
import { conflict, forbidden, type Ctx } from '@creatoros/services';
import { h3Form, ltxForm } from './ai-gateway-forms';
import { parseAutogenTimestamps, planGenerationGroups } from '@creatoros/domain';

export const productionPolicySchema=z.object({
  brandId:z.uuid(),rootId:z.uuid(),workerIds:z.array(z.uuid()).min(1).max(2),
  dailyVideos:z.number().int().min(1).max(2),
}).strict();
export type ProductionPolicy=z.infer<typeof productionPolicySchema>;
const rows=<T>(r:unknown)=>(r as {rows:T[]}).rows;
// Server-side environment is the authority; no client may override these limits.
export function dailyGatewayLimit(raw:string|undefined, fallback:number, name:string):number {
  if(raw===undefined||raw==='')return fallback;
  if(!/^\d{1,4}$/.test(raw)||Number(raw)>1000)throw new Error(name+' must be an integer from 0 to 1000.');
  return Number(raw);
}
export const generationLimit=(env:Ctx['env']['processEnv'])=>dailyGatewayLimit(env.AI_GATEWAY_DAILY_GENERATION_LIMIT,2,'AI_GATEWAY_DAILY_GENERATION_LIMIT');
export const imageUploadLimit=(env:Ctx['env']['processEnv'])=>dailyGatewayLimit(env.AI_GATEWAY_DAILY_IMAGE_UPLOAD_LIMIT,24,'AI_GATEWAY_DAILY_IMAGE_UPLOAD_LIMIT');
export const dedicatedImageOperations=['media.prepareImageUpload','media.uploadImage'] as const;
export function isDedicatedImageOperation(operation:string) {
  return (dedicatedImageOperations as readonly string[]).includes(operation);
}
export function matchesDedicatedUploadRoot(configured:string|undefined,rootId:unknown,root:{display_path:string;path_os:string}|undefined) {
  return !!configured&&z.uuid().safeParse(configured).success&&rootId===configured&&root?.path_os==='windows'&&root.display_path.toLowerCase().replace(/[\\/]+$/,'')==='d:\\chatgpt_uploads';
}
export async function isDedicatedUploadRoot(ctx:Ctx,rootId:unknown) {
  const configured=ctx.env.processEnv.AI_GATEWAY_CHATGPT_UPLOAD_ROOT_ID;
  if(!configured||!z.uuid().safeParse(configured).success||rootId!==configured)return false;
  const [root]=rows<{display_path:string;path_os:string}>(await ctx.db.execute(sql`select r.display_path,r.path_os from storage_roots r join devices d on d.id=r.device_id and d.org_id=r.org_id where r.id=${configured} and r.org_id=${ctx.orgId} and r.state='ACTIVE' and r.retired_at is null and d.state='ONLINE'`));
  return matchesDedicatedUploadRoot(configured,rootId,root);
}
// The caller has already authenticated the owner, checked media.upload.image and locked the connection.
export async function authorizeDedicatedImageUpload(ctx:Ctx,operation:string,input:unknown) {
  if(!isDedicatedImageOperation(operation))return false;
  const v=input as Record<string,unknown>;
  if(!await isDedicatedUploadRoot(ctx,v.rootId))return false;
  if(!rows(await ctx.db.execute(sql`select id from brands where id=${v.brandId} and org_id=${ctx.orgId} and active and deleted_at is null`)).length)throw forbidden('Choose an active creator.');
  if(v.projectId&&!rows(await ctx.db.execute(sql`select id from creative_projects where id=${v.projectId} and org_id=${ctx.orgId} and brand_id=${v.brandId} and deleted_at is null`)).length)throw forbidden('Choose a project belonging to the creator.');
  await checkImageUploadQuota(ctx);
  return true;
}
async function checkImageUploadQuota(ctx:Ctx) {
  const [count]=rows<{n:number}>(await ctx.db.execute(sql`select count(*)::int as n from ai_gateway_requests where org_id=${ctx.orgId} and policy_authorized and operation in ('media.prepareImageUpload','media.uploadImage') and created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver'`));
  if((count?.n??0)>=imageUploadLimit(ctx.env.processEnv))throw conflict('Daily image upload quota reached.',undefined,'production_quota_reached');
}
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
  if(operation==='media.uploadImage'){await checkImageUploadQuota(ctx);return true;}
  const isGeneration=(generationOperations as readonly string[]).includes(operation);
  const cap=isGeneration?Math.min(p.dailyVideos,generationLimit(ctx.env.processEnv)):operation==='projects.create'?p.dailyVideos:quotas[operation]!;
  const [count]=rows<{n:number}>(await ctx.db.execute(sql`select count(*)::int as n from ai_gateway_requests where org_id=${ctx.orgId} and policy_authorized and (case when ${isGeneration} then operation=any(ARRAY['generation.h3','generation.ltx','generation.longscene','generation.autogen']::text[]) else operation=${operation} end) and created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver'`));
  if((count?.n??0)>=cap)throw conflict('Daily trusted production limit reached.',undefined,'production_quota_reached');
  return true;
}


// Opt-in execution permission is separate from the operation's own scope.
// Explicit allowlist: new operations are review-only until classified.
export const creativeExecutionScope='production.execute';
export const creativeQuotas:Readonly<Record<string,number>>=Object.freeze({
  'projects.create':20,'projects.update':40,'scenes.upsert':20,'production.runStart':4,'production.runEvent':40,
  'media.uploadImage':24,'media.uploadAudio':4,
  'h3.save':20,'ltx.save':20,
  'longvideo.create':10,'longvideo.update':20,'longvideo.scene':40,
  'longvideo.split':20,'longvideo.rebalance':10,'longvideo.attach':24,
  'generation.h3':2,'generation.ltx':2,'generation.longscene':2,'generation.autogen':2,
  'publishing.draft':20,'publishing.thumbnail':20,'replies.draft':20,
});
export const creativeOperations=Object.keys(creativeQuotas);
export function canExecuteCreative(scopes:readonly string[],operation:string) {
  return scopes.includes(creativeExecutionScope)&&Object.hasOwn(creativeQuotas,operation);
}
export const generationOperations=['generation.h3','generation.ltx','generation.longscene','generation.autogen'] as const;

// Call only after locking the connector row, authenticating the owner and checking the operation scope.
export async function authorizeCreative(ctx:Ctx,operation:string,input:unknown) {
  if(!Object.hasOwn(creativeQuotas,operation))return false;
  const v=input as Record<string,unknown>;
  if(operation==='generation.h3'){
    const f=h3Form.parse(input);
    if(!f.projectId||!f.workerId||!f.segments.length||f.segments.some(s=>!s.durationSec)||f.segments.reduce((n,s)=>n+(s.durationSec??0),0)>30||f.megapixels>1.5)
      throw forbidden('Creative H3 needs a project, an enabled worker and explicit segment durations totaling at most 30 seconds.');
  }
  if(operation==='generation.ltx'){
    const f=ltxForm.parse(input);
    if(!f.projectId||!f.workerId||f.durationSec>30||f.width*f.height>2097152||f.fps>30)
      throw forbidden('Creative LTX needs a project, worker, at most 30 seconds, 2 MP and 30 fps.');
  }
  if(operation==='generation.autogen'){
    const starts=parseAutogenTimestamps(String(v.timestamps??''));
    if(starts.length!==1)throw forbidden('Creative AutoGen accepts one clip per request; use individual requests within the daily quota.');
  }
  if(operation==='generation.longscene'){
    const [projectRow]=rows<{id:string}>(await ctx.db.execute(sql`select id from long_video_projects where id=${v.projectId} and org_id=${ctx.orgId} and archived_at is null`));
    if(!projectRow)throw forbidden('Select an active long-video project.');
    const scenes=rows<{id:string;continuity:string;status:string;start_ms:number;end_ms:number;render_ms:number|null}>(await ctx.db.execute(sql`select id,continuity,status,start_ms,end_ms,render_ms from long_video_scenes where project_id=${projectRow.id} order by position`));
    const group=planGenerationGroups(scenes.map(s=>({id:s.id,continuity:s.continuity==='context'?'context':'shot',status:s.status})), 'one',String(v.sceneId))[0];
    const selected=scenes.filter(s=>group?.includes(s.id));
    if(!group?.length||selected.length!==group.length||selected.reduce((n,s)=>n+Math.max(s.end_ms-s.start_ms,s.render_ms??0),0)>30000)
      throw forbidden('Creative long-video generation requires an available group totaling at most 30 seconds.');
  }
  if(operation==='publishing.draft'||operation==='publishing.thumbnail'){
    const [target]=rows<{ok:boolean}>(await ctx.db.execute(sql`select exists(
      select 1 from publish_items i join distribution_variants v on v.id=i.variant_id and v.org_id=i.org_id
      join creative_projects p on p.id=v.project_id and p.org_id=v.org_id
      join social_accounts a on a.id=${v.socialAccountId} and a.org_id=i.org_id
      join channels c on c.id=a.channel_id and c.org_id=a.org_id
      where i.id=${v.itemId} and i.org_id=${ctx.orgId} and p.deleted_at is null and c.deleted_at is null
      and p.brand_id is not null and c.brand_id=p.brand_id and a.active and a.deleted_at is null
      and not exists(select 1 from publish_drafts d where d.org_id=i.org_id and d.item_id=i.id and d.social_account_id=a.id and d.upload_state<>'DRAFT')
    ) as ok`));
    if(!target?.ok)throw forbidden('Use an unscheduled draft and the social account belonging to its creator.');
  }
  if(operation==='media.uploadImage'){await checkImageUploadQuota(ctx);return true;}
  const isGeneration=(generationOperations as readonly string[]).includes(operation);
  const [count]=rows<{n:number}>(await ctx.db.execute(sql`select count(*)::int as n from ai_gateway_requests
    where org_id=${ctx.orgId} and policy_authorized
    and (case when ${isGeneration} then operation=any(ARRAY['generation.h3','generation.ltx','generation.longscene','generation.autogen']::text[]) else operation=${operation} end)
    and created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver'`));
  const cap=isGeneration?generationLimit(ctx.env.processEnv):creativeQuotas[operation]!;
  if((count?.n??0)>=cap)throw conflict('Daily creative execution limit reached. No approval request was created.',undefined,'production_quota_reached');
  return true;
}
