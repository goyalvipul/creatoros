import { createHash, randomInt } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { sql, type Db } from '@creatoros/db';
import { readWorkerQueue } from './comfy';
import { getAiProfile } from './ai';
import { openAgentFile } from './agent-file';
import { importGeneratedImage, MAX_GENERATED_IMAGE_BYTES } from './gateway-media';
import { audit } from './audit';
import { runEvent } from './production-run';
import { badRequest, conflict, notFound, systemCtx, type Ctx, type ServiceEnv } from './types';

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;
const slot = z.object({ node: z.string().regex(/^\d+$/), input: z.string().min(1).max(80) }).strict();
const graphSchema = z.record(z.string().regex(/^\d+$/), z.object({
  class_type: z.string().min(1).max(180), inputs: z.record(z.string(), z.unknown()),
}).passthrough());
const templateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), graph: graphSchema,
  prompt: slot, references: z.array(slot).min(1).max(8), seed: slot,
  width: slot.optional(), height: slot.optional(), outputNode: z.string().regex(/^\d+$/),
}).strict();
type Template = z.infer<typeof templateSchema>;
export const localImageInputSchema = z.object({
  projectId: z.uuid(), workerId: z.uuid(), rootId: z.uuid(),
  workflowId: z.string().min(1).max(80), prompt: z.string().trim().min(1).max(4000),
  referenceFileIds: z.array(z.uuid()).max(8), width: z.number().int().min(256).max(2048),
  height: z.number().int().min(256).max(2048),
}).strict().refine(p => p.width % 8 === 0 && p.height % 8 === 0 && p.width*p.height <= 4194304, 'Dimensions must be multiples of 8 and at most 4 MP.');
export type LocalImageInput = z.infer<typeof localImageInputSchema>;
export type LocalImageSnapshot={hash:string;references:string[]};
type Payload = LocalImageInput & LocalImageSnapshot & { seed: number };
type Job = { id:string; orgId:string; projectId:string; brandId:string; runId:string|null; workerId:string; rootId:string; state:string; payload:Payload; promptId:string|null; fileId:string|null; output:unknown; error:string|null; updatedAt:string };
const columns = sql`id,org_id as "orgId",project_id as "projectId",brand_id as "brandId",run_id as "runId",worker_id as "workerId",root_id as "rootId",state,payload,prompt_id as "promptId",file_id as "fileId",output,error,updated_at as "updatedAt"`;

export function validateTemplate(template: Template) {
  const mappings = [template.prompt, ...template.references, template.seed, ...[template.width,template.height].filter((x):x is NonNullable<typeof x>=>!!x)];
  const seen = new Set<string>();
  for (const mapping of mappings) {
    const key = mapping.node + ':' + mapping.input;
    const inputs = template.graph[mapping.node]?.inputs;
    if (seen.has(key) || !inputs || !Object.hasOwn(inputs,mapping.input) || Array.isArray(inputs[mapping.input])) throw badRequest('Workflow mappings must identify distinct literal inputs.');
    seen.add(key);
  }
  if (template.graph[template.outputNode]?.class_type !== 'SaveImage'||!Object.hasOwn(template.graph[template.outputNode]?.inputs??{},'filename_prefix')) throw badRequest('Workflow output must be an explicit SaveImage node.');
  if (!!template.width !== !!template.height) throw badRequest('Map both dimensions or neither.');
  for(const mapping of [template.prompt,...template.references])if(typeof template.graph[mapping.node]!.inputs[mapping.input]!=='string')throw badRequest('Prompt and reference mappings must be string inputs.');
  for(const mapping of [template.seed,template.width,template.height])if(mapping&&typeof template.graph[mapping.node]!.inputs[mapping.input]!=='number')throw badRequest('Seed and dimension mappings must be numeric inputs.');
  if(Object.values(template.graph).filter(n=>n.class_type==='SaveImage').length!==1)throw badRequest('Configure exactly one SaveImage node.');
  if (Object.keys(template.graph).length > 300) throw badRequest('Local image workflow exceeds the node budget.');
}
async function loadTemplates(env: ServiceEnv) {
  const file = env.processEnv.KEMOKEM_LOCAL_IMAGE_WORKFLOWS;
  if (!file) return [];
  const info=await stat(file);if(!info.isFile()||info.size>2*1024*1024)throw badRequest('Invalid local image workflow configuration file.');
  const bytes = await readFile(file);
  if (bytes.length > 2*1024*1024) throw badRequest('Local workflow configuration exceeds 2 MiB.');
  const templates = z.array(templateSchema).max(12).parse(JSON.parse(bytes.toString('utf8')));
  if (new Set(templates.map(t=>t.id)).size !== templates.length) throw badRequest('Duplicate local workflow IDs.');
  return templates.map(template => {
    validateTemplate(template);
    return {template, hash:createHash('sha256').update(JSON.stringify(template)).digest('hex')};
  });
}
export function buildLocalImageGraph(template:Template, input:{prompt:string; names:string[];seed:number;width:number;height:number;id:string}) {
  validateTemplate(template);
  if (input.names.length !== template.references.length) throw badRequest('Exact configured reference-slot count required.');
  if (!template.width || !template.height) throw badRequest('Configure explicit width and height mappings for this workflow.');
  const graph = structuredClone(template.graph);
  const set = (mapping:z.infer<typeof slot>,value:unknown) => {graph[mapping.node]!.inputs[mapping.input]=value;};
  set(template.prompt,input.prompt);set(template.seed,input.seed);
  set(template.width,input.width);set(template.height,input.height);
  template.references.forEach((mapping,i)=>set(mapping,input.names[i]!));
  graph[template.outputNode]!.inputs.filename_prefix='kemokem/local_'+input.id;
  return graph;
}
export async function localImageCapabilities(ctx:Ctx) {
  try {
    const templates=await loadTemplates(ctx.env);
    return {provider:'comfyui',configured:templates.length>0,workflows:templates.map(({template,hash})=>({id:template.id,referenceSlots:template.references.length,dimensionsMapped:!!template.width&&!!template.height,hash}))};
  } catch { return {provider:'comfyui',configured:false,error:'Invalid or unreadable owner workflow configuration.',workflows:[]}; }
}
export async function validateLocalImageInput(ctx:Ctx,input:LocalImageInput) {
  input=localImageInputSchema.parse(input);
  const [p]=rows<{brandId:string}>(await ctx.db.execute(sql`select brand_id as "brandId" from creative_projects where id=${input.projectId} and org_id=${ctx.orgId} and brand_id is not null and deleted_at is null and stage in ('DRAFT','IN_PROGRESS')`));
  if(!p)throw notFound('Active creator project');
  const profile=await getAiProfile(ctx,p.brandId);
  const references=[...new Set([...(profile?.referenceFileIds??[]),...input.referenceFileIds])];
  const configured=(await loadTemplates(ctx.env)).find(t=>t.template.id===input.workflowId);
  if(!configured||!configured.template.width||!configured.template.height)throw badRequest('Select a configured local image workflow with dimension mappings.');
  if(references.length!==configured.template.references.length)throw badRequest('Creator and explicit references must match the workflow reference slots exactly.');
  for(const id of references)if(!rows(await ctx.db.execute(sql`select id from file_instances where org_id=${ctx.orgId} and id=${id} and file_type='IMAGE' and availability='AVAILABLE' and archived_at is null`)).length)throw badRequest('A reference image is unavailable.');
  if(!rows(await ctx.db.execute(sql`select id from gpu_workers where org_id=${ctx.orgId} and id=${input.workerId} and enabled`)).length)throw notFound('Enabled GPU worker');
  if(!rows(await ctx.db.execute(sql`select id from storage_roots where org_id=${ctx.orgId} and id=${input.rootId} and retired_at is null and state='ACTIVE'`)).length)throw notFound('Active storage root');
  return {brandId:p.brandId, payload:{...input,references,hash:configured.hash,seed:randomInt(0,2147483647)}};
}
export async function queueLocalImage(ctx:Ctx,input:LocalImageInput,id:string,runId:string|null=null,snapshot?:LocalImageSnapshot) {
  const prior=rows<Job>(await ctx.db.execute(sql`select ${columns} from local_image_jobs where id=${id} and org_id=${ctx.orgId}`))[0];
  if(prior){if(prior.projectId!==input.projectId)throw conflict('Image request already used.');return prior;}
  const {brandId,payload}=await validateLocalImageInput(ctx,input);
  if(snapshot&&(snapshot.hash!==payload.hash||JSON.stringify(snapshot.references)!==JSON.stringify(payload.references)))throw conflict('Approved workflow or creator references changed. Restore the approved configuration or review the plan.');
  return ctx.db.transaction(async tx=>{
    await tx.execute(sql`select id from organizations where id=${ctx.orgId} for update`);
    const existing=rows<Job>(await tx.execute(sql`select ${columns} from local_image_jobs where id=${id} and org_id=${ctx.orgId}`))[0];
    if(existing)return existing;
    if(runId&&!rows(await tx.execute(sql`select id from production_runs where id=${runId} and org_id=${ctx.orgId} and brand_id=${brandId} and state='ACTIVE'`)).length)throw conflict('Production run is not active.');
    const [quota]=rows<{n:number}>(await tx.execute(sql`select count(*)::int as n from local_image_jobs where org_id=${ctx.orgId} and created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver'`));
    if((quota?.n??0)>=12)throw conflict('Daily local image job limit reached.');
    const [job]=rows<Job>(await tx.execute(sql`insert into local_image_jobs(id,org_id,project_id,brand_id,run_id,worker_id,root_id,payload) values(${id},${ctx.orgId},${input.projectId},${brandId},${runId},${input.workerId},${input.rootId},${JSON.stringify(payload)}::jsonb) returning ${columns}`));
    await audit({...ctx,db:tx},'production.local_image.queued',{type:'local_image_job',id});
    await runEvent(tx,ctx.orgId,runId,'IMAGE_QUEUED','Local image job '+id+' queued.');
    return job!;
  });
}
export async function localImageStatus(ctx:Ctx,id:string) {
  const [job]=rows<Job>(await ctx.db.execute(sql`select ${columns} from local_image_jobs where id=${id} and org_id=${ctx.orgId}`));
  if(!job)throw notFound('Local image job');
  return {id:job.id,state:job.state,projectId:job.projectId,workerId:job.workerId,promptId:job.promptId,fileId:job.fileId,error:job.error,output:job.output};
}
export async function cancelLocalImage(ctx:Ctx,id:string){
  const changed=rows(await ctx.db.execute(sql`update local_image_jobs set state='CANCELLED',error='Cancelled before GPU dispatch by owner.',updated_at=now() where id=${id} and org_id=${ctx.orgId} and state='QUEUED' returning id`));
  if(!changed.length)throw conflict('Only a queued local image can be cancelled. Do not interrupt unrelated GPU work.');
  await audit(ctx,'production.local_image.cancel',{type:'local_image_job',id});
  return {id,state:'CANCELLED'};
}
async function readBounded(body:ReadableStream<Uint8Array>,limit:number) {
  const reader=body.getReader();const chunks:Buffer[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw badRequest('Image exceeds the byte limit.');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>undefined);}
  return Buffer.concat(chunks,size);
}
async function uploadReference(ctx:Ctx,job:Job,baseUrl:string,id:string,i:number) {
  const file=await openAgentFile(ctx.db,ctx.env,ctx.orgId,id,(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(60000)}));
  if(file.size>MAX_GENERATED_IMAGE_BYTES)throw badRequest('Reference image exceeds 50 MiB.');
  const bytes=await readBounded(file.body,MAX_GENERATED_IMAGE_BYTES);
  const ext=file.mime==='image/png'?'png':file.mime==='image/jpeg'?'jpg':file.mime==='image/webp'?'webp':null;
  if(!ext)throw badRequest('Unsupported reference image format.');
  const form=new FormData();form.append('image',new Blob([new Uint8Array(bytes)],{type:file.mime}),'kk_'+job.id+'_'+i+'.'+ext);form.append('type','input');form.append('overwrite','false');
  const res=await fetch(new URL('/upload/image',baseUrl),{method:'POST',body:form,signal:AbortSignal.timeout(60000),redirect:'error'});
  if(!res.ok)throw badRequest('ComfyUI rejected a reference image.');
  const uploaded=z.object({name:z.string().regex(/^[a-zA-Z0-9_.-]+$/),subfolder:z.string().optional()}).parse(await res.json());
  if(uploaded.subfolder)throw badRequest('Unexpected reference upload subfolder.');
  return uploaded.name;
}
async function finish(db:Db,job:Job,state:string,error:string|null=null,output?:unknown,fileId?:string) {
  await db.transaction(async tx=>{
    const changed=rows(await tx.execute(sql`update local_image_jobs set state=${state},error=${error},output=coalesce(${output===undefined?null:JSON.stringify(output)}::jsonb,output),file_id=coalesce(${fileId??null}::uuid,file_id),updated_at=now() where id=${job.id} and org_id=${job.orgId} and state=${job.state} returning id`));
    if(changed.length)await runEvent(tx,job.orgId,job.runId,'IMAGE_'+state,error??'Local image '+job.id+' '+state.toLowerCase()+'.');
  });
}
export async function runDueLocalImages(db:Db,env:ServiceEnv) {
  // No blind resubmission after a crash at an external-write boundary.
  await db.execute(sql`update local_image_jobs set state='UNCERTAIN',error='Worker stopped during image submission/import. Inspect the original job and scanner before replacing it.',updated_at=now() where state in ('SUBMITTING','IMPORTING') and updated_at<now()-interval '12 minutes'`);
  await db.execute(sql`update local_image_jobs i set state='CANCELLED',error='Production stopped before image dispatch.',updated_at=now() from production_runs r where i.run_id=r.id and i.org_id=r.org_id and r.state='STOPPED' and i.state='QUEUED'`);
  // Recover only when the exact imported file is already linked to this creator/project.
  const recovered=rows<{id:string;orgId:string;runId:string|null;fileId:string}>(await db.execute(sql`update local_image_jobs i set state='COMPLETE',file_id=f.id,error=null,output=coalesce(i.output,'{}'::jsonb)||jsonb_build_object('fileId',f.id,'recovered',true),updated_at=now()
    from file_instances f join asset_file_links l on l.file_instance_id=f.id and l.org_id=f.org_id join asset_versions v on v.id=l.asset_version_id and v.org_id=l.org_id join logical_assets a on a.id=v.asset_id and a.org_id=v.org_id
    where i.state='UNCERTAIN' and i.prompt_id is not null and f.org_id=i.org_id and f.root_id=i.root_id and f.file_type='IMAGE' and f.availability='AVAILABLE' and f.archived_at is null
      and i.output->>'filename' is not null and f.file_name='kk_'||i.id::text||'_local-'||i.id::text||'.'||lower(substring(i.output->>'filename' from '[^.]+$'))
      and a.project_id=i.project_id and a.brand_id=i.brand_id and a.source='gateway-upload' and not a.is_archived
    returning i.id,i.org_id as "orgId",i.run_id as "runId",f.id as "fileId"`));
  for(const j of recovered)await runEvent(db,j.orgId,j.runId,'IMAGE_RECOVERED','Verified existing indexed image '+j.fileId+'.');
  const candidates=rows<Job>(await db.execute(sql`select ${columns} from local_image_jobs where state in ('QUEUED','RENDERING') order by updated_at,id limit 12`));
  for(const job of candidates){
    const ctx=systemCtx({db,env},job.orgId);
    const [worker]=rows<{baseUrl:string;enabled:boolean}>(await db.execute(sql`select base_url as "baseUrl",enabled from gpu_workers where id=${job.workerId} and org_id=${job.orgId}`));
    if(!worker?.enabled){await finish(db,job,'FAILED','GPU worker disabled or removed.');continue;}
    if(job.state==='QUEUED'){
      const claimed=await db.transaction(async tx=>{
        const [w]=rows<{id:string}>(await tx.execute(sql`select id from gpu_workers where id=${job.workerId} and org_id=${job.orgId} and enabled for update`));
        if(!w)return false;
        if(job.runId&&!rows(await tx.execute(sql`select r.id from production_runs r join organizations o on o.id=r.org_id where r.id=${job.runId} and r.org_id=${job.orgId} and r.state='ACTIVE' and coalesce(o.settings->'productionAutomation'->(r.brand_id::text)->>'paused','false')<>'true'`)).length)return false;
        if(rows(await tx.execute(sql`select id from generation_jobs where org_id=${job.orgId} and settings->>'workerId'=${job.workerId} and status='RUNNING' union all select id from local_image_jobs where org_id=${job.orgId} and worker_id=${job.workerId} and state in ('SUBMITTING','RENDERING')`)).length||await readWorkerQueue(worker.baseUrl)!=='free')return false;
        return rows(await tx.execute(sql`update local_image_jobs set state='SUBMITTING',updated_at=now() where id=${job.id} and org_id=${job.orgId} and state='QUEUED' returning id`)).length>0;
      });
      if(!claimed)continue;
      job.state='SUBMITTING';
      let submitted=false;
      try{
        const configured=(await loadTemplates(env)).find(t=>t.template.id===job.payload.workflowId&&t.hash===job.payload.hash);
        if(!configured)throw badRequest('Approved workflow changed; submit a new plan.');
        const names:string[]=[];
        for(const id of job.payload.references)if(!rows(await db.execute(sql`select id from file_instances where id=${id} and org_id=${job.orgId} and file_type='IMAGE' and availability='AVAILABLE' and archived_at is null`)).length)throw badRequest('A previously approved reference is no longer available.');
        for(const [i,id] of job.payload.references.entries())names.push(await uploadReference(ctx,job,worker.baseUrl,id,i));
        const graph=buildLocalImageGraph(configured.template,{...job.payload,names,id:job.id});
        if(job.runId&&!rows(await db.execute(sql`select r.id from production_runs r join organizations o on o.id=r.org_id where r.id=${job.runId} and r.org_id=${job.orgId} and r.state='ACTIVE' and coalesce(o.settings->'productionAutomation'->(r.brand_id::text)->>'paused','false')<>'true'`)).length){
          await finish(db,job,'QUEUED');return {advanced:1};
        }
        submitted=true;
        const res=await fetch(new URL('/prompt',worker.baseUrl),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:graph,client_id:job.id}),signal:AbortSignal.timeout(30000),redirect:'error'});
        if(!res.ok){if(res.status>=400&&res.status<500)submitted=false;throw badRequest('ComfyUI rejected the configured image workflow ('+res.status+').');}
        const result=z.object({prompt_id:z.string().min(1).max(200)}).parse(await res.json());
        await db.execute(sql`update local_image_jobs set state='RENDERING',prompt_id=${result.prompt_id},updated_at=now() where id=${job.id} and org_id=${job.orgId} and state='SUBMITTING'`);
        await runEvent(db,job.orgId,job.runId,'IMAGE_RENDERING','Local prompt accepted: '+job.id);
      }catch{await finish(db,job,submitted?'UNCERTAIN':'FAILED',submitted?'Image prompt submission not confirmed; do not replay.':'Local workflow validation, reference transfer or submission failed.');}
      return {advanced:1};
    }
    if(!job.promptId){await finish(db,job,'UNCERTAIN','Missing prompt acknowledgement.');continue;}
    try{
      const res=await fetch(new URL('/history/'+encodeURIComponent(job.promptId),worker.baseUrl),{signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!res.ok)continue;
      const body=await res.json() as Record<string,{status?:{completed?:boolean;status_str?:string};outputs?:Record<string,{images?:unknown[]}>}>;
      const entry=body[job.promptId];
      if(entry?.status?.status_str==='error'){await finish(db,job,'FAILED','ComfyUI reported image render failure.');continue;}
      if(!entry||entry.status?.completed!==true){if(Date.now()-Date.parse(job.updatedAt)>3*60*60_000)await finish(db,job,'UNCERTAIN','Image render exceeded three hours; inspect GPU history.');continue;}
      const configured=(await loadTemplates(env)).find(t=>t.template.id===job.payload.workflowId&&t.hash===job.payload.hash);
      if(!configured){await finish(db,job,'FAILED','Workflow changed after submission; inspect original output.');continue;}
      const output=z.object({filename:z.string().regex(/^[a-zA-Z0-9_.-]+\.(png|jpe?g|webp)$/i),subfolder:z.literal('kemokem'),type:z.literal('output')}).safeParse(entry.outputs?.[configured.template.outputNode]?.images?.[0]);
      if(!output.success||!output.data.filename.startsWith('local_'+job.id)){await finish(db,job,'FAILED','Expected job-specific SaveImage output missing.');continue;}
      const claimed=rows(await db.execute(sql`update local_image_jobs set state='IMPORTING',output=${JSON.stringify(output.data)}::jsonb,updated_at=now() where id=${job.id} and org_id=${job.orgId} and state='RENDERING' returning id`));
      if(!claimed.length)continue;
      job.state='IMPORTING';
      const url=new URL('/view',worker.baseUrl);url.search=new URLSearchParams(output.data).toString();
      const image=await fetch(url,{signal:AbortSignal.timeout(60000),redirect:'error'});
      if(!image.ok||!image.body)throw badRequest('Local output not accessible.');
      const bytes=await readBounded(image.body,MAX_GENERATED_IMAGE_BYTES);
      const ext=output.data.filename.split('.').pop()!.toLowerCase();
      const mime=ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg';
      const result=await importGeneratedImage(ctx,{rootId:job.rootId,brandId:job.brandId,projectId:job.projectId,fileName:'local-'+job.id+'.'+ext,mime},job.id,bytes);
      await finish(db,job,'COMPLETE',null,result,result.fileId);
      return {advanced:1};
    }catch{if(job.state==='IMPORTING')await finish(db,job,'UNCERTAIN','Output import not confirmed; inspect scanner and library before retrying.');}
  }
  return {advanced:0};
}
