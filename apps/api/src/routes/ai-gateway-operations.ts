import { z } from 'zod';
import { sql, and, eq, publishDrafts } from '@creatoros/db';
import {
  audit, badRequest, conflict, notFound, createProject, updateProject, upsertScenes,
  createLongVideo, updateLongVideo, updateLongVideoScene, splitLongVideoScene,
  addLongVideoFromLibrary, rebalanceLongVideo, queueLongVideoScene, cancelLongVideoScene,
  saveH3Draft, saveLtxDraft, generateH3, generateLtx, createAutogenRun, cancelAutogenClip,
  queueVideoAnalysis, getProjectScheduleRows, schedulePublish, saveSocialCoverBytes,
  analyticsDetail, listSocialThreads, getSocialThread, replyToThread, openAgentFile,
  workerQueue, startProductionRun, recordProductionPlanning, productionRunBoard, controlProductionRun, queueProjectImage, openAiAsset, aiStatus, type Ctx,
} from '@creatoros/services';
import { parseLocalDateTime, isValidTimeZone } from '@creatoros/domain';
import { h3Form, ltxForm } from './ai-gateway-forms';
import { uploadGatewayMedia, MAX_MEDIA_BASE64_CHARS, MAX_GENERATED_IMAGE_BYTES, importGeneratedImage } from './ai-gateway-media';
import { prepareBinaryUpload, binaryUploadSchema } from './ai-gateway-binary';
import { readFile, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const uuid = z.uuid();
const empty = z.object({}).strict();
const id = z.object({ id: uuid }).strict();
const text = z.string().max(20000);
const title = z.string().trim().min(1).max(200);
const requestText = z.string().trim().min(1).max(1000);
const rows = <T = Record<string, unknown>>(r: unknown) => (r as { rows: T[] }).rows;
const query = async (ctx: Ctx, statement: ReturnType<typeof sql>) => rows(await ctx.db.execute(statement));
async function owned(ctx: Ctx, kind: 'project'|'brand'|'file'|'worker'|'long', value?: string|null) {
  if (!value) return;
  const table = {project:'creative_projects',brand:'brands',file:'file_instances',worker:'gpu_workers',long:'long_video_projects'}[kind];
  const extra = kind==='project'||kind==='brand' ? sql`and deleted_at is null` : kind==='file'||kind==='long' ? sql`and archived_at is null` : sql`and enabled`;
  if (!(await query(ctx,sql`select id from ${sql.identifier(table)} where org_id=${ctx.orgId} and id=${value} ${extra}`)).length) throw notFound(kind);
}
async function availableMedia(ctx:Ctx,id:string|null|undefined,kind:'IMAGE'|'AUDIO'|'VIDEO') {
  if(!id)return;
  if(!(await query(ctx,sql`select id from file_instances where org_id=${ctx.orgId} and id=${id} and archived_at is null and availability='AVAILABLE' and file_type::text=${kind}`)).length)throw badRequest('Choose available library media of the requested type.');
}
async function validateForm(ctx: Ctx, form: z.infer<typeof h3Form>|z.infer<typeof ltxForm>) {
  await owned(ctx,'project',form.projectId);
  await owned(ctx,'worker',form.workerId);
  await availableMedia(ctx,form.imageFileId,'IMAGE');
  // Uploaded worker filenames are intentionally unsupported; use owned library IDs.
  if (form.imageUploadName || form.imageUploadWorkerId) throw badRequest('Use a library image ID, not a worker upload path.');
  if ('segments' in form) {
    for (const s of form.segments) {
      if(s.audioUploadName||s.audioUploadWorkerId||s.videoUploadName||s.videoUploadWorkerId) throw badRequest('Use library media IDs.');
      await availableMedia(ctx,s.audioFileId,'AUDIO'); await availableMedia(ctx,s.videoFileId,'VIDEO');
      for(const image of s.images) {
        if(image.uploadName||image.uploadWorkerId) throw badRequest('Use library image IDs.');
        await availableMedia(ctx,image.fileId,'IMAGE');
      }
    }
  } else {
    if(form.audioUploadName||form.audioUploadWorkerId) throw badRequest('Use a library audio ID.');
    await availableMedia(ctx,form.audioFileId,'AUDIO');
  }
}
const draftSchema=z.object({
  itemId:uuid,socialAccountId:uuid,title:z.string().max(300),caption:z.string().max(5000),
  hashtags:z.array(z.string().max(100)).max(30),privacy:z.string().max(40).nullable().optional(),
  contentForm:z.string().max(80).nullable().optional(),playlistIds:z.array(z.string().max(80)).max(20).optional(),
  aiUse:z.enum(['YES','NO']).nullable().optional(),
}).strict();
const scheduleSchema=draftSchema.extend({plannedLocal:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),timezone:z.string().max(64)});
async function draftTarget(ctx:Ctx,itemId:string,accountId:string) {
  const [target]=rows<{platform:string;project_id:string|null;file_name:string;handle:string}>(await ctx.db.execute(sql`
    select a.platform::text as platform,v.project_id,f.file_name,a.handle from publish_items i
    join distribution_variants v on v.id=i.variant_id and v.org_id=i.org_id
    join file_instances f on f.id=i.file_instance_id and f.org_id=i.org_id
    join social_accounts a on a.id=${accountId} and a.org_id=i.org_id and a.active and a.deleted_at is null
    where i.id=${itemId} and i.org_id=${ctx.orgId}`));
  if(!target) throw notFound('Video/account');
  return target;
}
async function saveDraft(ctx:Ctx,p:z.infer<typeof draftSchema>) {
  const target=await draftTarget(ctx,p.itemId,p.socialAccountId);
  if(target.platform==='youtube'&&(!p.title.trim()||p.title.length>100)) throw badRequest('YouTube title must contain 1–100 characters.');
  const values={title:p.title,caption:p.caption,hashtags:p.hashtags.map(h=>h.replace(/^#/,'')),privacy:p.privacy??(target.platform==='youtube'?'PRIVATE':null),contentForm:p.contentForm??null,playlistIds:p.playlistIds??[],aiUse:p.aiUse??'YES',updatedAt:new Date()};
  const [result]=await ctx.db.insert(publishDrafts).values({orgId:ctx.orgId,itemId:p.itemId,socialAccountId:p.socialAccountId,...values}).onConflictDoUpdate({
    target:[publishDrafts.itemId,publishDrafts.socialAccountId],
    set:values,setWhere:and(eq(publishDrafts.orgId,ctx.orgId),eq(publishDrafts.uploadState,'DRAFT')),
  }).returning({id:publishDrafts.id});
  if(!result) throw conflict('Only unsent drafts may be changed.');
  return result;
}
async function mediaBytes(ctx:Ctx,id:string,kind:'IMAGE'|'VIDEO',max:number) {
  const [f]=rows<{size:number;file_type:string;mime:string|null}>(await ctx.db.execute(sql`select size::float8 as size,file_type,mime from file_instances where org_id=${ctx.orgId} and id=${id} and archived_at is null and availability='AVAILABLE'`));
  if(!f||f.file_type!==kind) throw notFound('Media');
  if(f.size>max) throw badRequest('File exceeds gateway media size limit.');
  const file=await openAgentFile(ctx.db,ctx.env,ctx.orgId,id,(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(30000)}));
  const reader=file.body.getReader(); const chunks:Buffer[]=[]; let size=0;
  try { for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw badRequest('File exceeds gateway media size limit.');chunks.push(Buffer.from(value));} } finally { await reader.cancel().catch(()=>{}); }
  return Buffer.concat(chunks);
}
function referenceMime(bytes:Buffer) {
  return bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
}
async function referenceImage(ctx:Ctx,id:string) {
  const max=2*1024*1024;
  const bytes=await mediaBytes(ctx,id,'IMAGE',16*1024*1024);
  const mime=referenceMime(bytes);
  if(!mime)throw badRequest('Unsupported image type.');
  if(bytes.length<=max)return {mime,base64:bytes.toString('base64')};
  // Return a bounded preview, never modify the original library asset.
  const dir=await mkdtemp(join(tmpdir(),'kk-reference-'));
  try{
    const input=join(dir,'input');
    const out=join(dir,'preview.jpg');
    await writeFile(input,bytes,{mode:0o600});
    const format=mime==='image/png'?'png_pipe':mime==='image/webp'?'webp_pipe':'jpeg_pipe';
    await exec('ffmpeg',['-nostdin','-v','error','-y','-threads','1','-max_alloc','67108864','-protocol_whitelist','file,pipe','-f',format,'-i',input,'-frames:v','1','-vf','scale=1536:1536:force_original_aspect_ratio=decrease','-q:v','4',out],{timeout:15000,maxBuffer:65536});
    const preview=await readFile(out);
    if(!preview.length||preview.length>max||referenceMime(preview)!=='image/jpeg')throw badRequest('Reference preview exceeds media limit.');
    return {mime:'image/jpeg',base64:preview.toString('base64')};
  } finally {await rm(dir,{recursive:true,force:true});}
}
async function keyframes(ctx:Ctx,p:{id:string;seconds:number[]}) {
  const dir=await mkdtemp(join(tmpdir(),'kk-gateway-'));
  try {
    await writeFile(join(dir,'input'),await mediaBytes(ctx,p.id,'VIDEO',64*1024*1024));
    const frames=[];
    for(const second of p.seconds){
      const out=join(dir,'frame.jpg');
      await exec('ffmpeg',['-nostdin','-v','error','-y','-threads','1','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,avi,mpegts,mpeg,flv','-ss',String(second),'-i',join(dir,'input'),'-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease','-q:v','5',out],{timeout:15000,maxBuffer:65536});
      const bytes=await readFile(out);
      if(bytes.length>300000)throw badRequest('Frame exceeds limit.');
      frames.push({second,mime:'image/jpeg',base64:bytes.toString('base64')});
      await rm(out);
    }
    return {frames};
  } finally {await rm(dir,{recursive:true,force:true});}
}

export const permissionGroups = [
  {name:'Creators',items:[['creators.read','Read creator profiles and instructions'],['references.read','Retrieve reference images']]},
  {name:'Production',items:[['production.execute','Execute authorized creative work without individual approval'],['projects.read','Read projects'],['projects.write','Create draft projects'],['projects.update','Update projects'],['scenes.write','Manage scenes and clips']]},
  {name:'Creative Studio',items:[['studio.read','Read studio projects and drafts'],['h3.write','Write H3 prompts and drafts'],['ltx.write','Write LTX prompts and drafts'],['longvideo.write','Manage long videos']]},
  {name:'Media and analysis',items:[['media.read','Read media inventory, analysis and transcripts'],['media.upload.image','Upload images to indexed storage'],['media.upload.audio','Upload audio to indexed storage'],['frames.read','Extract video keyframes'],['analysis.request','Request billable Gemini analysis'],['image.generate','Request billable Gemini project images']]},
  {name:'GPU and generation',items:[['gpu.read','Read GPU availability'],['generation.read','Read generation jobs and output IDs'],['generation.submit','Queue generation jobs'],['generation.cancel','Cancel specific generation jobs']]},
  {name:'Publishing and SEO',items:[['publishing.read','Read publishing queue and social accounts'],['publishing.write','Save platform publishing drafts'],['thumbnail.write','Attach custom thumbnails'],['schedule.write','Schedule approved videos'],['schedule.manage','Reschedule or cancel pending uploads']]},
  {name:'Analytics',items:[['analytics.read','Read stored analytics, post performance and demographics']]},
  {name:'Unified Inbox',items:[['comments.read','Read comments'],['messages.read','Read direct messages'],['replies.draft','Draft replies'],['replies.send','Send approved replies']]},
] as const;
export const scopes=permissionGroups.flatMap(g=>g.items.map(item=>item[0]));
type Scope=(typeof permissionGroups)[number]['items'][number][0];
type Operation={scope:Scope;write:boolean;schema:z.ZodType;run:(ctx:Ctx,p:unknown,requestId:string,trusted?:boolean)=>Promise<unknown>};
function op<T extends z.ZodType>(scope:Scope,write:boolean,schema:T,run:(ctx:Ctx,p:z.output<T>,requestId:string,trusted?:boolean)=>Promise<unknown>):Operation {
  return {scope,write,schema,run:(ctx,p,r,trusted)=>run(ctx,schema.parse(p),r,trusted)};
}
const uploadSchema=z.object({rootId:uuid,brandId:uuid,projectId:uuid.nullable().optional(),fileName:z.string().min(1).max(120),mime:z.string().max(40),base64:z.string().min(4).max(MAX_MEDIA_BASE64_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict();
const projectPatch=z.object({title:title.optional(),brief:text.optional(),concept:text.optional(),songTitle:z.string().max(300).optional(),hook:text.optional(),narrative:text.optional(),distributionPlan:text.optional()}).strict();
const longScene=z.object({projectId:uuid,sceneId:uuid,prompt:text.optional(),label:z.string().max(160).optional(),mode:z.enum(['vocal','broll']).optional(),continuity:z.enum(['shot','context']).optional(),workerId:uuid.nullable().optional(),durationSec:z.number().min(1).max(120).optional()}).strict();
const scenePair=z.object({projectId:uuid,sceneId:uuid}).strict();
const replySchema=z.object({id:uuid,connectionId:uuid,text:requestText}).strict();
export const operations:Record<string,Operation>={
 'creators.list':op('creators.read',false,empty,ctx=>query(ctx,sql`select id,name,description,content_pillars from brands where org_id=${ctx.orgId} and deleted_at is null order by name limit 100`)),
 'creators.profile':op('creators.read',false,z.object({brandId:uuid.nullable()}).strict(),async(ctx,p)=>{await owned(ctx,'brand',p.brandId);return query(ctx,sql`select name,niche,languages,tone,voice,themes,visual_notes,avoid,hashtags,links,disclosure,character_name,character_notes,reference_file_ids from ai_profiles where org_id=${ctx.orgId} and brand_id is not distinct from ${p.brandId}::uuid limit 1`);}),
 'references.image':op('references.read',false,id,(ctx,p)=>referenceImage(ctx,p.id)),
 'projects.list':op('projects.read',false,empty,ctx=>query(ctx,sql`select id,title,stage,brief,brand_id from creative_projects where org_id=${ctx.orgId} and deleted_at is null order by created_at desc limit 100`)),
 'projects.detail':op('projects.read',false,id,async(ctx,p)=>{await owned(ctx,'project',p.id);return {project:(await query(ctx,sql`select id,title,stage,brief,concept,song_title,hook,narrative,distribution_plan from creative_projects where org_id=${ctx.orgId} and id=${p.id}`))[0],scenes:await query(ctx,sql`select id,ordinal,title,narration,direction,shot_prompt,timecode_start_ms,timecode_end_ms,status from production_scenes where org_id=${ctx.orgId} and project_id=${p.id} order by ordinal`)};}),
 'projects.create':op('projects.write',true,z.object({title,brief:text.optional(),brandId:uuid.nullable().optional()}).strict(),async(ctx,p)=>{await owned(ctx,'brand',p.brandId);return createProject(ctx,{...p,type:'OTHER',contentFormat:'OTHER'});}),
 'projects.update':op('projects.update',true,z.object({id:uuid,patch:projectPatch}).strict(),async(ctx,p)=>{await owned(ctx,'project',p.id);return updateProject(ctx,p.id,p.patch);}),
 'scenes.upsert':op('scenes.write',true,z.object({projectId:uuid,scenes:z.array(z.object({ordinal:z.number().int().min(0).max(1000),title:title.optional(),narration:text.optional(),direction:text.optional(),shotPrompt:text.optional(),timecodeStartMs:z.number().int().nonnegative().optional(),timecodeEndMs:z.number().int().nonnegative().optional()}).strict()).min(1).max(100)}).strict(),async(ctx,p)=>{await owned(ctx,'project',p.projectId);return upsertScenes(ctx,p.projectId,p.scenes);}),
 'studio.h3':op('studio.read',false,empty,ctx=>query(ctx,sql`select project_id,worker_id,image_file_id,prompt,aspect_ratio,megapixels,audio_locked,share_audio,video_locked,share_video,segments from h3_drafts where org_id=${ctx.orgId}`)),
 'studio.ltx':op('studio.read',false,empty,ctx=>query(ctx,sql`select project_id,worker_id,image_file_id,audio_file_id,audio_start_sec,duration_sec,prompt,negative_prompt,width,height,fps,lora_name,lora_strength,upscale_width,upscale_height,want_upscale from ltx_drafts where org_id=${ctx.orgId}`)),
 'studio.longvideos':op('studio.read',false,empty,ctx=>query(ctx,sql`select id,title,status,aspect,brand_id,creative_project_id,duration_ms,worker_id from long_video_projects where org_id=${ctx.orgId} and archived_at is null order by updated_at desc limit 100`)),
 'studio.longvideo':op('studio.read',false,id,async(ctx,p)=>{await owned(ctx,'long',p.id);return {project:(await query(ctx,sql`select id,title,status,aspect,duration_ms,worker_id from long_video_projects where id=${p.id} and org_id=${ctx.orgId}`))[0],scenes:await query(ctx,sql`select s.id,s.position,s.start_ms,s.end_ms,s.label,s.prompt,s.mode,s.status,s.job_id from long_video_scenes s join long_video_projects p on p.id=s.project_id where p.id=${p.id} and p.org_id=${ctx.orgId} order by s.position`),refs:await query(ctx,sql`select r.id,r.scene_id,r.kind,r.name from long_video_refs r join long_video_projects p on p.id=r.project_id where p.id=${p.id} and p.org_id=${ctx.orgId}`)};}),
 'h3.save':op('h3.write',true,h3Form,async(ctx,p)=>{await validateForm(ctx,p);await saveH3Draft(ctx,p);return {saved:true};}),
 'ltx.save':op('ltx.write',true,ltxForm,async(ctx,p)=>{await validateForm(ctx,p);await saveLtxDraft(ctx,p);return {saved:true};}),
 'longvideo.create':op('longvideo.write',true,z.object({title,brandId:uuid.nullable().optional(),aspect:z.string().max(80).optional()}).strict(),async(ctx,p)=>{await owned(ctx,'brand',p.brandId);const r=await createLongVideo(ctx,p);return {id:r.id};}),
 'longvideo.update':op('longvideo.write',true,z.object({id:uuid,title:title.optional(),aspect:z.string().max(80).optional(),workerId:uuid.nullable().optional(),targetSceneMs:z.number().int().min(4000).max(15000).optional()}).strict(),async(ctx,{id,...p})=>{await owned(ctx,'worker',p.workerId);await updateLongVideo(ctx,id,p);return {id};}),
 'longvideo.scene':op('longvideo.write',true,longScene,async(ctx,{projectId,sceneId,...p})=>{await owned(ctx,'worker',p.workerId);await updateLongVideoScene(ctx,projectId,sceneId,p);return {id:sceneId};}),
 'longvideo.split':op('longvideo.write',true,scenePair,async(ctx,p)=>{await splitLongVideoScene(ctx,p.projectId,p.sceneId);return {updated:true};}),
 'longvideo.rebalance':op('longvideo.write',true,z.object({id:uuid,seconds:z.number().min(4).max(15)}).strict(),async(ctx,p)=>{await rebalanceLongVideo(ctx,p.id,p.seconds);return {updated:true};}),
 'longvideo.attach':op('longvideo.write',true,z.object({projectId:uuid,fileId:uuid,sceneId:uuid.nullable()}).strict(),async(ctx,p)=>{await owned(ctx,'file',p.fileId);await addLongVideoFromLibrary(ctx,p.projectId,p.fileId,p.sceneId);return {attached:true};}),
 'media.list':op('media.read',false,z.object({kind:z.enum(['IMAGE','VIDEO','AUDIO']).default('VIDEO')}).strict(),(ctx,p)=>query(ctx,sql`select id,file_name,file_type,tech from file_instances where org_id=${ctx.orgId} and archived_at is null and availability='AVAILABLE' and file_type::text=${p.kind} order by created_at desc limit 100`)),
 'media.prepareImageUpload':op('media.upload.image',true,binaryUploadSchema,(ctx,p,r)=>prepareBinaryUpload(ctx,p,r,'IMAGE')),
 'media.prepareAudioUpload':op('media.upload.audio',true,binaryUploadSchema,(ctx,p,r)=>prepareBinaryUpload(ctx,p,r,'AUDIO')),
 'media.uploadImage':op('media.upload.image',true,uploadSchema,(ctx,p,r)=>uploadGatewayMedia(ctx,p,r,'IMAGE')),
 'media.uploadAudio':op('media.upload.audio',true,uploadSchema,(ctx,p,r)=>uploadGatewayMedia(ctx,p,r,'AUDIO')),
 'media.roots':op('media.read',false,empty,ctx=>query(ctx,sql`select r.id,r.display_path,d.display_name as device_name,r.state,d.state as device_state from storage_roots r join devices d on d.id=r.device_id and d.org_id=r.org_id where r.org_id=${ctx.orgId} and r.retired_at is null order by d.display_name,r.display_path limit 100`)),
 'media.search':op('media.read',false,z.object({q:z.string().max(200).optional(),kind:z.enum(['IMAGE','VIDEO','AUDIO']).optional(),brandId:uuid.optional(),limit:z.number().int().min(1).max(100).default(50),offset:z.number().int().min(0).max(10000).default(0)}).strict(),async(ctx,p)=>{await owned(ctx,'brand',p.brandId);return query(ctx,sql`select f.id,f.file_name,f.file_type,f.mime,f.tech,f.availability,f.size::float8 as size from file_instances f where f.org_id=${ctx.orgId} and f.archived_at is null and (${p.kind??null}::text is null or f.file_type::text=${p.kind??null}) and (${p.q??null}::text is null or strpos(lower(f.file_name),lower(${p.q??''}))>0) and (${p.brandId??null}::uuid is null or exists(select 1 from asset_file_links l join asset_versions v on v.id=l.asset_version_id and v.org_id=l.org_id join logical_assets a on a.id=v.asset_id and a.org_id=v.org_id where l.org_id=f.org_id and l.file_instance_id=f.id and a.brand_id=${p.brandId??null} and not a.is_archived)) order by f.created_at desc,f.id limit ${p.limit} offset ${p.offset}`);}),
 'media.detail':op('media.read',false,id,async(ctx,p)=>{await owned(ctx,'file',p.id);return (await query(ctx,sql`select f.id,f.file_name,f.file_type,f.mime,f.tech,f.availability,f.size::float8 as size,d.state as device_state,r.state as root_state from file_instances f join devices d on d.id=f.device_id and d.org_id=f.org_id join storage_roots r on r.id=f.root_id and r.org_id=f.org_id where f.org_id=${ctx.orgId} and f.id=${p.id}`))[0];}),
 'gpu.queue':op('gpu.read',false,id,async(ctx,p)=>{await owned(ctx,'worker',p.id);return workerQueue(ctx,p.id);}),
 'media.analysis':op('media.read',false,id,(ctx,p)=>query(ctx,sql`select j.id,j.status,j.output,j.finished_at from ai_jobs j join file_instances f on f.id::text=j.target_id and f.org_id=j.org_id where j.org_id=${ctx.orgId} and f.id=${p.id} and j.target_type='library_file' and j.task='video_analyze' order by j.created_at desc limit 5`)),
 'media.transcript':op('media.read',false,id,async(ctx,p)=>{await owned(ctx,'file',p.id);const [r]=rows<{transcript:unknown}>(await ctx.db.execute(sql`select output->'analysis'->'transcript' as transcript from ai_jobs where org_id=${ctx.orgId} and task='video_analyze' and target_type='library_file' and target_id=${p.id} and status='COMPLETED' order by finished_at desc limit 1`));return {available:Array.isArray(r?.transcript),transcript:r?.transcript??null,source:'Gemini video analysis; not a verified verbatim transcript'};}),
 'media.keyframes':op('frames.read',false,z.object({id:uuid,seconds:z.array(z.number().min(0).max(7200)).min(1).max(4)}).strict(),keyframes),
 'media.analyze':op('analysis.request',true,id,async(ctx,p,r)=>{await owned(ctx,'file',p.id);if(!(await query(ctx,sql`select id from file_instances where org_id=${ctx.orgId} and id=${p.id} and file_type='VIDEO'`)).length)throw badRequest('Choose a video.');const job=await queueVideoAnalysis(ctx,{fileId:p.id,acceptBillable:true,idempotencyKey:r});return {id:job.id,status:job.status};}),
 'gpu.list':op('gpu.read',false,empty,ctx=>query(ctx,sql`select id,label,role,enabled,last_ok,last_checked_at,reported_vram_gb,expected_vram_gb from gpu_workers where org_id=${ctx.orgId} order by label`)),
 'generation.jobs':op('generation.read',false,empty,ctx=>query(ctx,sql`select id,project_id,scene_id,provider,status,created_at,started_at,finished_at,error,settings->>'workerId' as worker_id,settings->'progress' as progress,settings->>'outputScanStatus' as output_scan_status,settings->>'outputScanRequestedAt' as output_scan_requested_at,coalesce(settings->>'dispatchPaused','false')='true' as paused from generation_jobs where org_id=${ctx.orgId} order by created_at desc limit 100`)),
 'generation.outputs':op('generation.read',false,id,(ctx,p)=>query(ctx,sql`select o.id,o.file_instance_id,o.asset_version_id,o.output_role from generation_outputs o join generation_jobs j on j.id=o.job_id and j.org_id=o.org_id where o.org_id=${ctx.orgId} and j.id=${p.id}`)),
 'production.runStart':op('projects.write',true,z.object({brandId:uuid,localDay:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),target:z.number().int().min(1).max(2)}).strict(),(ctx,p)=>startProductionRun(ctx,p)),
 'production.runEvent':op('projects.update',true,z.object({runId:uuid,stage:z.enum(['RESEARCHING','PLANNED','BLOCKED','FAILED']),detail:z.string().min(1).max(4000)}).strict(),(ctx,p)=>recordProductionPlanning(ctx,p)),
 'production.runs':op('generation.read',false,empty,ctx=>productionRunBoard(ctx)),
 'production.runDetail':op('generation.read',false,id,(ctx,p)=>productionRunBoard(ctx,p.id)),
 // These new writes are intentionally owner-reviewed; do not add them to the creative allowlist.
 'production.runControl':op('generation.cancel',true,z.object({id:uuid,action:z.enum(['pause','resume','stop'])}).strict(),(ctx,p)=>controlProductionRun(ctx,p.id,p.action)),
 'generation.imageCapabilities':op('image.generate',false,empty,async ctx=>{const status=await aiStatus(ctx);return {provider:'gemini',availability:status.gemini,enabled:status.settings.enabled,imageModel:status.settings.imageModel,imageSize:status.settings.imageSize,usage:status.usage.image,billingNote:status.billingNote};}),
 'generation.image':op('image.generate',true,z.object({projectId:uuid,prompt:z.string().trim().min(1).max(4000),referenceFileIds:z.array(uuid).max(8),aspect:z.enum(['16:9','9:16','1:1','4:5','3:2','4:3','21:9']),acceptBillable:z.literal(true)}).strict(),async(ctx,p,r)=>{const job=await queueProjectImage(ctx,{...p,idempotencyKey:r});return {id:job.id,status:job.status};}),
 'generation.imageStatus':op('generation.read',false,id,async(ctx,p)=>{
   const [job]=await query(ctx,sql`select id,status,error,target_id as "projectId",brand_id as "brandId",created_at,finished_at from ai_jobs where org_id=${ctx.orgId} and id=${p.id} and target_type='creative_project' and task='scene_image_generate'`);
   if(!job)throw notFound('Project image job');
   const assets=job.status==='COMPLETED'?await query(ctx,sql`select id,mime,bytes,width,height,reference_ids from ai_assets where org_id=${ctx.orgId} and job_id=${p.id} and kind='image' and path like 'ai/%'`):[];
   return {job,assets};
 }),
 'media.importGeneratedImage':op('media.upload.image',true,z.object({assetId:uuid,rootId:uuid,projectId:uuid,brandId:uuid}).strict(),async(ctx,p,r)=>{
   const [asset]=rows<{mime:string;bytes:number}>(await ctx.db.execute(sql`select a.mime,a.bytes from ai_assets a join ai_jobs j on j.id=a.job_id and j.org_id=a.org_id join creative_projects c on c.id=a.project_id and c.org_id=a.org_id and c.brand_id=j.brand_id where a.id=${p.assetId} and a.org_id=${ctx.orgId} and a.kind='image' and j.status='COMPLETED' and j.target_type='creative_project' and j.target_id=c.id::text and c.id=${p.projectId} and c.brand_id=${p.brandId} and c.deleted_at is null`));
   if(!asset)throw notFound('Completed project image');
   const ext=asset.mime==='image/png'?'png':asset.mime==='image/jpeg'?'jpg':asset.mime==='image/webp'?'webp':null;
   if(!ext||asset.bytes<1||asset.bytes>MAX_GENERATED_IMAGE_BYTES)throw badRequest('Generated image type or size is unsupported.');
   const opened=await openAiAsset(ctx,p.assetId);
   const info=await stat(opened.abs);
   if(!info.isFile()||info.size!==asset.bytes||info.size>MAX_GENERATED_IMAGE_BYTES)throw badRequest('Generated asset size changed.');
   const bytes=await readFile(opened.abs);
   if(bytes.length!==asset.bytes)throw badRequest('Generated asset size changed.');
   return importGeneratedImage(ctx,{rootId:p.rootId,projectId:p.projectId,brandId:p.brandId,fileName:'generated-'+p.assetId+'.'+ext,mime:asset.mime},r,bytes);
 }),
 'generation.h3':op('generation.submit',true,h3Form.extend({runId:uuid.optional(),sourceEvidence:z.string().min(1).max(20000).optional()}),async(ctx,p,_requestId,trusted)=>{await validateForm(ctx,p);const r=await generateH3(ctx,p,{skipDraft:trusted===true,serialDispatch:trusted===true,runId:p.runId,sourceEvidence:p.sourceEvidence});return {id:r.job.id,status:r.job.status};}),
 'generation.ltx':op('generation.submit',true,ltxForm,async(ctx,p,_requestId,trusted)=>{await validateForm(ctx,p);if(trusted&&(!p.workerId||(await workerQueue(ctx,p.workerId)).queue!=='free'))throw conflict('GPU is busy or offline; defer generation.');const r=await generateLtx(ctx,p,{skipDraft:trusted===true});return {id:r.job.id};}),
 'generation.longscene':op('generation.submit',true,scenePair,async(ctx,p)=>{await queueLongVideoScene(ctx,p.projectId,p.sceneId);return {queued:true};}),
 'generation.autogen':op('generation.submit',true,z.object({prompt:text,timestamps:z.string().max(2000),songName:z.string().min(1).max(300),audioLengthSec:z.number().positive().max(7200).optional(),audioFileId:uuid,imageFileId:uuid}).strict(),async(ctx,p)=>{await availableMedia(ctx,p.audioFileId,'AUDIO');await availableMedia(ctx,p.imageFileId,'IMAGE');const r=await createAutogenRun(ctx,p);return {id:r.id};}),
 'generation.cancelClip':op('generation.cancel',true,id,(ctx,p)=>cancelAutogenClip(ctx,p.id)),
 'generation.cancelScene':op('generation.cancel',true,scenePair,async(ctx,p)=>{await cancelLongVideoScene(ctx,p.projectId,p.sceneId);return {cancelled:true};}),
 'publishing.accounts':op('publishing.read',false,empty,ctx=>query(ctx,sql`select a.id,a.platform,a.handle,c.brand_id from social_accounts a join channels c on c.id=a.channel_id and c.org_id=a.org_id where a.org_id=${ctx.orgId} and a.active and a.deleted_at is null and c.deleted_at is null order by a.platform,a.handle`)),
 'publishing.queue':op('publishing.read',false,empty,ctx=>query(ctx,sql`select i.id as item_id,v.project_id,f.file_name,d.id as draft_id,d.social_account_id,d.title,d.caption,d.hashtags,d.upload_state,d.scheduled_at from publish_items i join distribution_variants v on v.id=i.variant_id and v.org_id=i.org_id join file_instances f on f.id=i.file_instance_id and f.org_id=i.org_id left join publish_drafts d on d.item_id=i.id and d.org_id=i.org_id where i.org_id=${ctx.orgId} order by i.created_at desc limit 200`)),
 'publishing.preview':op('publishing.read',false,id,(ctx,p)=>getProjectScheduleRows(ctx,p.id)),
 'publishing.draft':op('publishing.write',true,draftSchema,saveDraft),
 'publishing.thumbnail':op('thumbnail.write',true,z.object({itemId:uuid,socialAccountId:uuid,base64:z.string().max(2700000).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict(),async(ctx,p)=>{const t=await draftTarget(ctx,p.itemId,p.socialAccountId);if((await query(ctx,sql`select id from publish_drafts where org_id=${ctx.orgId} and item_id=${p.itemId} and social_account_id=${p.socialAccountId} and upload_state<>'DRAFT'`)).length)throw conflict('Only unscheduled draft thumbnails may be changed.');if(!t.project_id)throw badRequest('Link a project first.');return saveSocialCoverBytes(ctx,t.project_id,p.itemId,p.socialAccountId,Buffer.from(p.base64,'base64'));}),
 'publishing.schedule':op('schedule.write',true,scheduleSchema,async(ctx,p,r)=>{await draftTarget(ctx,p.itemId,p.socialAccountId);await schedulePublish(ctx,{...p,requestId:r});return {scheduled:true};}),
 'publishing.cancel':op('schedule.manage',true,id,async(ctx,p)=>ctx.db.transaction(async tx=>{const [d]=rows<{publication_id:string|null}>(await tx.execute(sql`update publish_drafts set upload_state='DRAFT',scheduled_at=null,request_id=null,updated_at=now() where org_id=${ctx.orgId} and id=${p.id} and upload_state='SCHEDULED' returning publication_id`));if(!d)throw conflict('Only pending scheduled uploads can be cancelled.');if(d.publication_id)await tx.execute(sql`update publication_records set state='PLANNED',planned_at=null,updated_at=now() where org_id=${ctx.orgId} and id=${d.publication_id} and state='SCHEDULED'`);return {cancelled:true};})),
 'publishing.reschedule':op('schedule.manage',true,z.object({id:uuid,plannedLocal:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),timezone:z.string().max(64)}).strict(),async(ctx,p)=>{
   if(!isValidTimeZone(p.timezone))throw badRequest('Invalid timezone.');
   const at=parseLocalDateTime(p.plannedLocal,p.timezone);
   if(!Number.isFinite(at.getTime())||at.getTime()<=Date.now())throw badRequest('Choose a future time.');
   return ctx.db.transaction(async tx=>{
     const [d]=rows<{publication_id:string|null}>(await tx.execute(sql`update publish_drafts set scheduled_at=${at.toISOString()}::timestamptz,updated_at=now() where org_id=${ctx.orgId} and id=${p.id} and upload_state='SCHEDULED' returning publication_id`));
     if(!d)throw conflict('Only pending scheduled uploads can be rescheduled.');
     if(d.publication_id)await tx.execute(sql`update publication_records set planned_at=${at.toISOString()}::timestamptz,planned_timezone=${p.timezone},updated_at=now() where org_id=${ctx.orgId} and id=${d.publication_id} and state='SCHEDULED'`);
     return {scheduledAt:at.toISOString()};
   });
 }),
 'analytics.demographics':op('analytics.read',false,empty,ctx=>query(ctx,sql`select distinct on (social_account_id) social_account_id,platform,state,detail,reporting_on,endpoint,provenance from account_metric_snapshots where org_id=${ctx.orgId} and metric='demographics' order by social_account_id,collected_at desc`)),
 'analytics.detail':op('analytics.read',false,z.object({days:z.number().int().min(1).max(90).default(30),brandId:uuid.optional()}).strict(),(ctx,p)=>analyticsDetail(ctx,{from:new Date(Date.now()-p.days*86400000),brandId:p.brandId},'America/Vancouver')),
 'comments.list':op('comments.read',false,empty,ctx=>listSocialThreads(ctx,{kind:'COMMENT',limit:50})),
 'messages.list':op('messages.read',false,empty,ctx=>listSocialThreads(ctx,{kind:'DM',limit:50})),
 'comments.detail':op('comments.read',false,id,async(ctx,p)=>{const t=await getSocialThread(ctx,p.id);if(t.kind!=='COMMENT')throw notFound('Comment');return t;}),
 'messages.detail':op('messages.read',false,id,async(ctx,p)=>{const t=await getSocialThread(ctx,p.id);if(t.kind!=='DM')throw notFound('Message');return t;}),
 'replies.draft':op('replies.draft',true,replySchema,(ctx,p,r)=>replyToThread(ctx,p.id,{connectionId:p.connectionId,text:p.text,requestId:r,send:false})),
 'replies.send':op('replies.send',true,replySchema,(ctx,p,r)=>replyToThread(ctx,p.id,{connectionId:p.connectionId,text:p.text,requestId:r,send:true})),
};
