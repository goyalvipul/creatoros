import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { sql, aiJobs, aiAssets, eq, and, type Db } from '@creatoros/db';
import { z } from 'zod';
import { projectImageReferences } from './ai';
import { readWorkerQueue } from './comfy';
import { openAgentFile } from './agent-file';
import { badRequest, conflict, notFound, systemCtx, type Ctx, type ServiceEnv } from './types';

const rows=<T>(r:unknown)=>(r as {rows:T[]}).rows;
const TASK='project_image_local';
const MAX_IMAGE=50*1024*1024;
const nodeId=z.string().regex(/^\d+$/);
const binding=z.object({node:nodeId,input:z.string().regex(/^[A-Za-z0-9_]+$/)}).strict();
const configSchema=z.object({
  workflow:z.record(nodeId,z.object({class_type:z.string().min(1),inputs:z.record(z.string(),z.unknown())}).passthrough()),
  prompt:binding, width:binding, height:binding, seed:binding,
  references:z.array(binding).min(1).max(8), outputNode:nodeId,
  workerIds:z.array(z.uuid()).min(1).max(8), minVramGb:z.number().min(0).max(96).default(0),
}).strict();
type Config=z.infer<typeof configSchema>;
type LocalInput={projectId:string;prompt:string;referenceFileIds:string[];width:number;height:number;seed:number;configHash:string;workerId?:string;runId?:string};
type LocalJob=typeof aiJobs.$inferSelect;
export function parseLocalImageConfig(raw:string) {
  const config=configSchema.parse(JSON.parse(raw));
  const mapped=[config.prompt,config.width,config.height,config.seed,...config.references];
  if(new Set(mapped.map(b=>b.node+':'+b.input)).size!==mapped.length)throw badRequest('Image workflow bindings must be distinct.');
  for(const b of mapped){
    if(!config.workflow[b.node]||!Object.hasOwn(config.workflow[b.node]!.inputs,b.input))throw badRequest('Image workflow binding not found.');
  }
  for(const b of config.references)if(config.workflow[b.node]?.class_type!=='LoadImage'||b.input!=='image')throw badRequest('Reference bindings must be LoadImage.image.');
  const output=config.workflow[config.outputNode];
  if(output?.class_type!=='SaveImage'||!Object.hasOwn(output.inputs,'filename_prefix'))throw badRequest('Configure a SaveImage output node.');
  return config;
}
async function loadConfig(env:ServiceEnv) {
  const file=env.processEnv.KEMOKEM_LOCAL_IMAGE_CONFIG;
  if(!file)throw badRequest('Local still-image workflow is not configured. Set KEMOKEM_LOCAL_IMAGE_CONFIG on API and worker.');
  const raw=await readFile(file,'utf8');
  if(Buffer.byteLength(raw)>2*1024*1024)throw badRequest('Local image workflow config exceeds 2 MiB.');
  return {config:parseLocalImageConfig(raw),hash:createHash('sha256').update(raw).digest('hex')};
}
export async function localImageCapabilities(ctx:Ctx) {
  if(!ctx.env.processEnv.KEMOKEM_LOCAL_IMAGE_CONFIG)return {configured:false,reason:'No local image workflow configured.'};
  try{
    const {config,hash}=await loadConfig(ctx.env);
    const workers=rows<{id:string;label:string;vram:number|null}>(await ctx.db.execute(sql`select id,label,coalesce(reported_vram_gb,expected_vram_gb)::float8 as vram from gpu_workers where org_id=${ctx.orgId} and enabled and id::text in (${sql.join(config.workerIds.map(id=>sql`${id}`),sql`,`)})`)).filter(w=>(w.vram??0)>=config.minVramGb);
    return {configured:workers.length>0,workflowHash:hash,referenceSlots:config.references.length,workers,minimumVramGb:config.minVramGb};
  }catch{return {configured:false,reason:'Local image workflow configuration is invalid or unreadable.'};}
}
export function buildLocalImageGraph(config:Config,input:{prompt:string;width:number;height:number;seed:number;imageNames:string[];jobId:string}) {
  if(input.imageNames.length!==config.references.length)throw badRequest('Exact reference slot count is required; no references are silently dropped.');
  const graph=structuredClone(config.workflow);
  const set=(b:{node:string;input:string},v:unknown)=>{graph[b.node]!.inputs[b.input]=v;};
  set(config.prompt,input.prompt);set(config.width,input.width);set(config.height,input.height);set(config.seed,input.seed);
  config.references.forEach((b,i)=>set(b,input.imageNames[i]!));
  graph[config.outputNode]!.inputs.filename_prefix='kemokem_image_'+input.jobId;
  return graph;
}
export async function queueLocalProjectImage(ctx:Ctx,input:{projectId:string;prompt:string;referenceFileIds:string[];width:number;height:number;seed?:number;idempotencyKey:string;runId?:string}){
  const [old]=await ctx.db.select().from(aiJobs).where(and(eq(aiJobs.orgId,ctx.orgId),eq(aiJobs.idempotencyKey,input.idempotencyKey))).limit(1);
  if(old){if(old.task!==TASK||old.targetId!==input.projectId)throw conflict('Image request ID already used.');return old;}
  const {config,hash}=await loadConfig(ctx.env);
  if(!input.prompt.trim()||input.prompt.length>4000||![input.width,input.height].every(x=>Number.isInteger(x)&&x>=256&&x<=2048&&x%8===0)||input.width*input.height>2097152)throw badRequest('Invalid image prompt or dimensions (max 2 MP, multiples of 8).');
  const [p]=rows<{brandId:string}>(await ctx.db.execute(sql`select brand_id as "brandId" from creative_projects where org_id=${ctx.orgId} and id=${input.projectId} and brand_id is not null and deleted_at is null and stage in ('DRAFT','IN_PROGRESS')`));
  if(!p)throw notFound('Creator project');
  const refs=await projectImageReferences(ctx,p.brandId,input.referenceFileIds);
  if(refs.length!==config.references.length)throw badRequest('The local workflow requires exactly '+config.references.length+' reference images. Configure matching slots.');
  return ctx.db.transaction(async tx=>{
    await tx.execute(sql`select id from organizations where id=${ctx.orgId} for update`);
    const [prior]=await tx.select().from(aiJobs).where(and(eq(aiJobs.orgId,ctx.orgId),eq(aiJobs.idempotencyKey,input.idempotencyKey))).limit(1);
    if(prior){if(prior.task!==TASK||prior.targetId!==input.projectId)throw conflict('Image request ID already used.');return prior;}
    const [count]=rows<{n:number}>(await tx.execute(sql`select count(*)::int as n from ai_jobs where org_id=${ctx.orgId} and task=${TASK} and created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver'`));
    if((count?.n??0)>=8)throw conflict('Daily local still-image limit reached.');
    const [job]=await tx.insert(aiJobs).values({orgId:ctx.orgId,userId:ctx.userId,brandId:p.brandId,task:TASK,provider:'comfyui',model:hash,status:'QUEUED',idempotencyKey:input.idempotencyKey,targetType:'creative_project',targetId:input.projectId,input:{projectId:input.projectId,prompt:input.prompt,referenceFileIds:refs,width:input.width,height:input.height,seed:input.seed??Math.floor(Math.random()*2147483647),configHash:hash,runId:input.runId??null}}).returning();
    return job!;
  });
}
async function readBounded(body:ReadableStream<Uint8Array>,limit:number){
  const reader=body.getReader(),chunks:Buffer[]=[];let n=0;
  try{for(;;){const v=await reader.read();if(v.done)break;n+=v.value.byteLength;if(n>limit)throw badRequest('Image exceeds local workflow byte limit.');chunks.push(Buffer.from(v.value));}}finally{await reader.cancel().catch(()=>undefined);}
  return Buffer.concat(chunks);
}
async function placeReference(ctx:Ctx,origin:string,id:string,jobId:string,index:number){
  const opened=await openAgentFile(ctx.db,ctx.env,ctx.orgId,id);
  if(!opened.mime.startsWith('image/')||opened.size>MAX_IMAGE)throw badRequest('Invalid local image reference.');
  const bytes=await readBounded(opened.body,MAX_IMAGE);
  const ext=opened.mime==='image/png'?'png':opened.mime==='image/jpeg'?'jpg':opened.mime==='image/webp'?'webp':null;
  if(!ext)throw badRequest('Unsupported local reference image format.');
  const name='kk_'+jobId+'_'+index+'.'+ext;
  const form=new FormData();form.append('image',new Blob([Uint8Array.from(bytes)],{type:opened.mime}),name);form.append('type','input');form.append('overwrite','false');
  const response=await fetch(new URL('/upload/image',origin),{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw badRequest('ComfyUI rejected a reference upload.');
  const result=await response.json() as {name?:string;subfolder?:string};
  if(!result.name||!/^[-A-Za-z0-9_.]+$/.test(result.name)||result.name.includes('..')||result.subfolder)throw badRequest('Unexpected ComfyUI reference name.');
  return result.name;
}
async function finishLocal(db:Db,job:LocalJob,env:ServiceEnv) {
  const input=job.input as LocalInput,output=job.output as {promptId?:string;outputNode?:string}|null;
  if(!output?.promptId){
    if(job.startedAt&&Date.now()-job.startedAt.getTime()>10*60_000)await db.update(aiJobs).set({status:'FAILED',error:'Local submission outcome uncertain. Check the selected ComfyUI history before retrying.',finishedAt:new Date()}).where(and(eq(aiJobs.id,job.id),eq(aiJobs.status,'RUNNING')));
    return;
  }
  const [worker]=rows<{baseUrl:string}>(await db.execute(sql`select base_url as "baseUrl" from gpu_workers where org_id=${job.orgId} and id=${input.workerId} and enabled`));
  if(!worker)return;
  const response=await fetch(new URL('/history/'+encodeURIComponent(output.promptId),worker.baseUrl),{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return;
  const history=await response.json() as Record<string,{status?:{completed?:boolean;status_str?:string};outputs?:Record<string,{images?:{filename:string;subfolder:string;type:string}[]}>}>;
  const item=history[output.promptId];
  if(item?.status?.status_str==='error'){await db.update(aiJobs).set({status:'FAILED',error:'ComfyUI reported image generation failure.',finishedAt:new Date()}).where(and(eq(aiJobs.id,job.id),eq(aiJobs.status,'RUNNING')));return;}
  if(!item?.status?.completed)return;
  const images=item.outputs?.[output.outputNode??'']?.images??[];
  if(images.length!==1)throw badRequest('Local workflow must return exactly one still from its configured SaveImage node.');
  const image=images[0]!;
  if(image.type!=='output'||!/^[-A-Za-z0-9_.]+$/.test(image.filename)||image.filename.includes('..')||!image.filename.startsWith('kemokem_image_'+job.id)||image.subfolder)throw badRequest('Unexpected local image output.');
  const url=new URL('/view',worker.baseUrl);url.search=new URLSearchParams({filename:image.filename,type:'output',subfolder:''}).toString();
  const res=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!res.ok||!res.body)throw badRequest('Local output could not be retrieved.');
  const bytes=await readBounded(res.body,MAX_IMAGE);
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(!png||bytes.length<24)throw badRequest('Configured SaveImage must return PNG.');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<1||height<1||width>4096||height>4096)throw badRequest('Invalid image dimensions.');
  // Stable asset ID and atomic file placement make repeated history reads safe after restart.
  const rel='ai/'+job.orgId+'/'+job.id+'.png',abs=join(env.attachmentsDir,rel),temp=abs+'.'+randomUUID()+'.tmp';
  await mkdir(join(env.attachmentsDir,'ai',job.orgId),{recursive:true});
  await writeFile(temp,bytes,{mode:0o600});await rename(temp,abs);
  await db.transaction(async tx=>{
    const [locked]=rows<{status:string}>(await tx.execute(sql`select status from ai_jobs where id=${job.id} and org_id=${job.orgId} for update`));
    if(locked?.status!=='RUNNING')return;
    await tx.insert(aiAssets).values({id:job.id,orgId:job.orgId,jobId:job.id,projectId:input.projectId,kind:'image',path:rel,mime:'image/png',width,height,bytes:bytes.length,prompt:input.prompt,model:job.model,referenceIds:input.referenceFileIds}).onConflictDoNothing();
    await tx.update(aiJobs).set({status:'COMPLETED',output:{...output,assets:[job.id]},finishedAt:new Date(),error:null}).where(eq(aiJobs.id,job.id));
  });
}
export async function runDueLocalImages(db:Db,env:ServiceEnv){
  const running=await db.select().from(aiJobs).where(and(eq(aiJobs.task,TASK),eq(aiJobs.status,'RUNNING'))).limit(8);
  for(const job of running)try{await finishLocal(db,job,env);}catch{/* Keep a known prompt ID for safe polling; never resubmit it. */}
  const [job]=rows<LocalJob>(await db.execute(sql`select id,org_id as "orgId",user_id as "userId",brand_id as "brandId",model,input,status from ai_jobs j where task=${TASK} and status='QUEUED' and (input->>'runId' is null or exists(select 1 from production_runs r join organizations o on o.id=r.org_id where r.id::text=j.input->>'runId' and r.org_id=j.org_id and r.state='ACTIVE' and coalesce(o.settings->'productionAutomation'->(r.brand_id::text)->>'paused','false')<>'true')) order by created_at limit 1`));
  if(!job)return;
  const input=job.input as LocalInput,ctx=systemCtx({db,env},job.orgId);
  let loaded:Awaited<ReturnType<typeof loadConfig>>;
  try{loaded=await loadConfig(env);if(loaded.hash!==input.configHash)throw conflict('Image workflow changed after approval.');}catch{await db.update(aiJobs).set({status:'FAILED',error:'Configured local image workflow is missing or changed.',finishedAt:new Date()}).where(and(eq(aiJobs.id,job.id),eq(aiJobs.status,'QUEUED')));return;}
  const {config}=loaded;
  const candidates=rows<{id:string;baseUrl:string}>(await db.execute(sql`select id,base_url as "baseUrl" from gpu_workers where org_id=${job.orgId} and enabled and coalesce(reported_vram_gb,expected_vram_gb,0)>=${config.minVramGb} and id::text in (${sql.join(config.workerIds.map(id=>sql`${id}`),sql`,`)}) order by coalesce(reported_vram_gb,expected_vram_gb,0) desc`));
  for(const worker of candidates){
    const claimed=await db.transaction(async tx=>{
      const [w]=rows<{id:string}>(await tx.execute(sql`select id from gpu_workers where org_id=${job.orgId} and id=${worker.id} and enabled for update`));if(!w)return false;
      if(rows(await tx.execute(sql`select id from generation_jobs where org_id=${job.orgId} and settings->>'workerId'=${worker.id} and status='RUNNING' union all select id from ai_jobs where org_id=${job.orgId} and task=${TASK} and status='RUNNING' and input->>'workerId'=${worker.id} limit 1`)).length)return false;
      if(await readWorkerQueue(worker.baseUrl)!=='free')return false;
      return rows(await tx.execute(sql`update ai_jobs set status='RUNNING',started_at=now(),attempts=attempts+1,input=input||${JSON.stringify({workerId:worker.id})}::jsonb where id=${job.id} and org_id=${job.orgId} and status='QUEUED' returning id`)).length===1;
    });
    if(!claimed)continue;
    try{
      if(!job.brandId)throw badRequest('Creator missing.');
      const [project]=rows(await db.execute(sql`select id from creative_projects where id=${input.projectId} and org_id=${job.orgId} and brand_id=${job.brandId} and deleted_at is null and stage in ('DRAFT','IN_PROGRESS')`));if(!project)throw badRequest('Project no longer available.');
      const ids=await projectImageReferences(ctx,job.brandId,input.referenceFileIds);
      if(ids.length!==config.references.length||ids.some((id,i)=>id!==input.referenceFileIds[i]))throw badRequest('Creator references changed after approval.');
      const names=[];for(const [index,id] of ids.entries())names.push(await placeReference(ctx,worker.baseUrl,id,job.id,index));
      const graph=buildLocalImageGraph(config,{...input,imageNames:names,jobId:job.id});
      const response=await fetch(new URL('/prompt',worker.baseUrl),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:graph,client_id:job.id}),signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw badRequest('ComfyUI rejected the configured image workflow.');
      const result=await response.json() as {prompt_id?:string};
      if(!result.prompt_id||!z.uuid().safeParse(result.prompt_id).success)throw badRequest('ComfyUI did not return a verified prompt ID.');
      await db.update(aiJobs).set({output:{promptId:result.prompt_id,outputNode:config.outputNode}}).where(and(eq(aiJobs.id,job.id),eq(aiJobs.status,'RUNNING')));
    }catch{await db.update(aiJobs).set({status:'FAILED',error:'Local image submission failed or is uncertain; inspect ComfyUI history before retrying.',finishedAt:new Date()}).where(and(eq(aiJobs.id,job.id),eq(aiJobs.status,'RUNNING')));}
    return;
  }
}
