import {sql,publishDrafts,type Db} from '@creatoros/db';
import {redactSecrets,type MetadataDraft} from '@creatoros/domain';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,mkdir,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openAgentFile} from './agent-file';
import {queueVideoAnalysis,createProductionMetadata} from './ai';
import {readSocialCover,saveSocialCoverBytes} from './social-cover';
import {notify} from './notifications';
import {audit} from './audit';
import {runEvent,runPrefs,runPlatforms,setAutomatedProjectStage,reconcileProductionRuns} from './production-run';
import {runDueProductionPlans} from './production-plan';
import {runDueLocalImages} from './local-image';
import {badRequest,conflict,notFound,systemCtx,type Ctx,type ServiceEnv} from './types';

const exec=promisify(execFile);
const rows=<T>(r:unknown)=>(r as {rows:T[]}).rows;
type Post={phase:string;detail?:string;lease?:string|null;leaseAt?:string;fileId?:string;itemId?:string;analysisId?:string;metadata?:Record<string,MetadataDraft>;covers?:string[];prefilled?:string[];missingPlatforms?:string[];attempt?:number;failedPhase?:string};
type Job={id:string;orgId:string;projectId:string;brandId:string;title:string;status:string;runId:string|null;settings:Record<string,unknown>;post:Post|null};
const terminal=['READY','FAILED','STOPPED'];
const phaseLabels:Record<string,string>={WAIT_INDEX:'Waiting for indexed final video',ANALYSIS:'Video analysis',METADATA:'Platform SEO',COVERS:'Cover generation',PREFILL:'Publishing draft prefill',AWAITING_ACCOUNTS:'Waiting for creator accounts',BLOCKED_BILLING:'AI billing authorization required',READY:'Ready for review',FAILED:'Post-processing failed',STOPPED:'Post-processing stopped'};
export function coverSeconds(timestamp:unknown){
  if(typeof timestamp!=='string')return 1;
  const parts=timestamp.trim().split(':');
  if(parts.length>3||parts.some(p=>!/^\d+(?:\.\d+)?$/.test(p)))return 1;
  const seconds=parts.reduce((n,p)=>n*60+Number(p),0);
  return Number.isFinite(seconds)&&seconds>=0&&seconds<=30?seconds:1;
}
function coverPath(env:ServiceEnv,jobId:string,platform:string){return join(env.attachmentsDir,'production-covers',jobId,platform+'.jpg');}
async function makeCovers(ctx:Ctx,j:Job,post:Post,timestamp:number){
  if(!post.fileId||!post.metadata)throw badRequest('Missing video or SEO package.');
  const opened=await openAgentFile(ctx.db,ctx.env,ctx.orgId,post.fileId,(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(90000)}));
  const limit=64*1024*1024;
  if(opened.size>limit)throw badRequest('Video exceeds the 64 MiB cover limit.');
  const reader=opened.body.getReader(),chunks:Buffer[]=[];
  let n=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>limit)throw badRequest('Video exceeds cover limit.');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  const dir=await mkdtemp(join(tmpdir(),'kk-cover-'));
  try{
    const video=join(dir,'input.mp4'),frame=join(dir,'frame.jpg'),caption=join(dir,'headline.txt');
    await writeFile(video,Buffer.concat(chunks),{mode:0o600});
    // Use the analysis-selected moment, not invented imagery. Keep the whole posture visible.
    const args=['-nostdin','-v','error','-y','-threads','1','-protocol_whitelist','file,pipe','-ss',String(timestamp),'-i',video,'-frames:v','1','-q:v','3',frame];
    try{await exec('ffmpeg',args,{timeout:20000,maxBuffer:65536});await readFile(frame);}catch{await exec('ffmpeg',['-nostdin','-v','error','-y','-threads','1','-protocol_whitelist','file,pipe','-i',video,'-frames:v','1','-q:v','3',frame],{timeout:20000,maxBuffer:65536});}
    await mkdir(join(ctx.env.attachmentsDir,'production-covers',j.id),{recursive:true});
    for(const platform of runPlatforms){
      const draft=post.metadata[platform];if(!draft)throw badRequest('Missing '+platform+' SEO.');
      // Two short lines, no cropping of the subject; textfile + expansion=none avoids filter injection.
      const text=draft.thumbnailText.replace(/[\r\n\t]/g,' ').trim().slice(0,48);
      const words=text.split(/\s+/),lines=[''];
      for(const word of words){const last=lines.length-1;if(lines[last]!.length+word.length>23&&lines.length<2)lines.push(word);else lines[last]=(lines[last]+' '+word).trim();}
      await writeFile(caption,lines.join('\n'),{mode:0o600});
      const filter="scale=1080:1600:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:260+(1600-ih)/2:color=0x15251F,drawbox=x=0:y=0:w=1080:h=250:color=0x15251F:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile="+caption+":expansion=none:fontcolor=white:fontsize=58:line_spacing=12:x=(w-tw)/2:y=(250-th)/2";
      const out=join(dir,platform+'.jpg');
      await exec('ffmpeg',['-nostdin','-v','error','-y','-threads','1','-protocol_whitelist','file,pipe','-i',frame,'-vf',filter,'-frames:v','1','-q:v','4',out],{timeout:20000,maxBuffer:65536});
      const bytes=await readFile(out);
      if(!bytes.length||bytes.length>2*1024*1024||bytes[0]!==255||bytes[1]!==216)throw badRequest('Cover encoding failed or exceeds 2 MiB.');
      const target=coverPath(ctx.env,j.id,platform),temp=target+'.'+randomUUID()+'.tmp';
      await writeFile(temp,bytes,{mode:0o600});await rename(temp,target);
    }
    return [...runPlatforms];
  }finally{await rm(dir,{recursive:true,force:true});}
}
async function loadJob(ctx:Ctx,id:string){
  const [j]=rows<Job>(await ctx.db.execute(sql`select j.id,j.org_id as "orgId",j.project_id as "projectId",p.brand_id as "brandId",p.title,j.status,j.settings,j.settings->>'productionRunId' as "runId",j.settings->'postProduction' as post
    from generation_jobs j join creative_projects p on p.id=j.project_id and p.org_id=j.org_id
    where j.org_id=${ctx.orgId} and j.id=${id} and j.provider='comfyui-h3' and p.deleted_at is null`));
  if(!j)throw notFound('H3 production job');
  return j;
}
export async function productionPackageForItem(ctx:Ctx,itemId:string){
  const [j]=rows<{id:string;post:Post}>(await ctx.db.execute(sql`select j.id,j.settings->'postProduction' as post from generation_jobs j join publish_items i on i.id::text=j.settings->'postProduction'->>'itemId' and i.org_id=j.org_id where j.org_id=${ctx.orgId} and i.id=${itemId} order by j.created_at desc limit 1`));
  return j??null;
}
export async function getProductionCover(ctx:Ctx,id:string,platform:string){
  if(!(runPlatforms as readonly string[]).includes(platform))throw notFound('Cover');
  const j=await loadJob(ctx,id);
  if(!j.post?.covers?.includes(platform))throw notFound('Cover');
  return readFile(coverPath(ctx.env,j.id,platform));
}
async function findOutput(ctx:Ctx,j:Job){
  const [f]=rows<{fileId:string;itemId:string}>(await ctx.db.execute(sql`select f.id as "fileId",i.id as "itemId" from generation_outputs o join file_instances f on f.id=o.file_instance_id and f.org_id=o.org_id
    join publish_items i on i.file_instance_id=f.id and i.org_id=f.org_id
    join distribution_variants v on v.id=i.variant_id and v.org_id=i.org_id
    where o.job_id=${j.id} and o.org_id=${ctx.orgId} and o.output_role='final'
      and f.archived_at is null and f.availability='AVAILABLE' and f.file_type='VIDEO' and v.project_id=${j.projectId}
    order by o.created_at desc limit 1`));
  return f;
}
async function applyPublishing(ctx:Ctx,j:Job,post:Post){
  const f=await findOutput(ctx,j);
  if(!f||f.fileId!==post.fileId||f.itemId!==post.itemId||!post.metadata)throw conflict('The selected publishing output changed. Review before retrying.');
  const accounts=rows<{id:string;platform:string}>(await ctx.db.execute(sql`select a.id,a.platform::text as platform from social_accounts a join channels c on c.id=a.channel_id and c.org_id=a.org_id
    where a.org_id=${ctx.orgId} and c.brand_id=${j.brandId} and a.active and a.deleted_at is null and c.deleted_at is null and a.platform::text in ('youtube','instagram','facebook','tiktok','threads','x')`));
  const prefilled:string[]=[];
  for(const a of accounts){
    if(post.prefilled?.includes(a.id)){prefilled.push(a.id);continue;}
    const m=post.metadata[a.platform];if(!m)throw badRequest('Missing metadata for '+a.platform);
    const title=m.recommendedTitle.trim().slice(0,a.platform==='youtube'?100:300),caption=(a.platform==='youtube'?m.description:m.caption).trim().slice(0,a.platform==='youtube'?5000:a.platform==='x'?280:2200);
    // The existing YouTube draft field named hashtags is actually used for comma-delimited video tags.
    const hashtags=(a.platform==='youtube'?m.tags:m.hashtags).map(h=>h.replace(/^#/,'').trim()).filter(Boolean).slice(0,a.platform==='youtube'?15:12);
    await ctx.db.insert(publishDrafts).values({orgId:ctx.orgId,itemId:f.itemId,socialAccountId:a.id,title,caption,hashtags,privacy:a.platform==='youtube'?'PRIVATE':null,contentForm:a.platform==='youtube'?'SHORT':a.platform==='instagram'?'REEL':null,aiUse:'YES'}).onConflictDoNothing();
    // Fill empty fields only; never overwrite manual edits or modify sent/scheduled drafts.
    await ctx.db.execute(sql`update publish_drafts set title=coalesce(nullif(trim(title),''),${title}),caption=coalesce(nullif(trim(caption),''),${caption}),hashtags=case when cardinality(hashtags)=0 then ARRAY(select jsonb_array_elements_text(${JSON.stringify(hashtags)}::jsonb)) else hashtags end,ai_use=coalesce(ai_use,'YES'),updated_at=now()
      where org_id=${ctx.orgId} and item_id=${f.itemId} and social_account_id=${a.id} and upload_state='DRAFT'`);
    const [saved]=rows<{state:string;title:string|null;caption:string|null}>(await ctx.db.execute(sql`select upload_state as state,title,caption from publish_drafts where org_id=${ctx.orgId} and item_id=${f.itemId} and social_account_id=${a.id}`));
    if(saved?.state!=='DRAFT'||!saved.title?.trim()||!saved.caption?.trim())throw conflict('Publishing draft is missing or has already left draft state.');
    if(!await readSocialCover(ctx,ctx.orgId,f.itemId,a.id)){
      await saveSocialCoverBytes(ctx,j.projectId,f.itemId,a.id,await readFile(coverPath(ctx.env,j.id,a.platform)));
    }
    if(!await readSocialCover(ctx,ctx.orgId,f.itemId,a.id))throw conflict('Cover was not saved.');
    prefilled.push(a.id);
  }
  return {prefilled,missingPlatforms:runPlatforms.filter(p=>!accounts.some(a=>a.platform===p))};
}
async function finish(ctx:Ctx,j:Job,lease:string,post:Post){
  return ctx.db.transaction(async tx=>{
    const changed=rows(await tx.execute(sql`update generation_jobs set settings=jsonb_set(settings,'{postProduction}',${JSON.stringify({...post,lease:null,leaseAt:null})}::jsonb,true),updated_at=now()
      where id=${j.id} and org_id=${ctx.orgId} and settings->'postProduction'->>'lease'=${lease} returning id`));
    if(!changed.length)return false;
    if(post.phase!==j.post?.phase||post.detail!==j.post?.detail)await runEvent(tx,ctx.orgId,j.runId,post.phase,post.detail??phaseLabels[post.phase]??post.phase,j.id);
    if(post.phase==='READY'){
      const [r]=rows<{state:string}>(await tx.execute(sql`select state from production_runs where id=${j.runId} and org_id=${ctx.orgId}`));
      if(r?.state!=='STOPPED')await setAutomatedProjectStage(tx,ctx.orgId,j.projectId,'READY','Final video, analysis, platform covers and connected publishing drafts verified; human review before publication.');
    }
    return true;
  });
}
async function advance(ctx:Ctx,j:Job){
  const p:Post=j.post??{phase:'WAIT_INDEX',attempt:1};
  const lease=randomUUID();
  const claimed=rows(await ctx.db.execute(sql`update generation_jobs set settings=jsonb_set(settings,'{postProduction}',${JSON.stringify({...p,lease,leaseAt:new Date().toISOString()})}::jsonb,true),updated_at=now()
    where id=${j.id} and org_id=${ctx.orgId} and status='SUCCEEDED' and coalesce(settings->>'dispatchPaused','false')<>'true'
      and settings->'postProduction'->>'lease' is null
      and coalesce(settings->'postProduction'->>'phase','WAIT_INDEX')=${p.phase}
      and not exists(select 1 from production_runs r join organizations o on o.id=r.org_id where r.id::text=generation_jobs.settings->>'productionRunId' and r.org_id=generation_jobs.org_id and (r.state<>'ACTIVE' or o.settings->'productionAutomation'->(r.brand_id::text)->>'paused'='true'))
    returning id`));
  if(!claimed.length)return;
  let next:Post={...p};
  try{
    const prefs=(await runPrefs(ctx))[j.brandId];
    if(p.phase==='WAIT_INDEX'){
      const f=await findOutput(ctx,j);
      if(!f){const [age]=rows<{expired:boolean}>(await ctx.db.execute(sql`select greatest(finished_at,coalesce((settings->>'outputScanRetryAt')::timestamptz,finished_at))<now()-interval '1 day' as expired from generation_jobs where id=${j.id} and org_id=${ctx.orgId}`));if(age?.expired)throw conflict('Final output has not been indexed. Check the worker output root.');}
      next=f?{...p,...f,phase:'ANALYSIS',detail:'Final file indexed and linked to publishing.'}:{...p,detail:'Waiting for final output to be indexed and linked. Scanner requests are automatic.'};
    }else if(p.phase==='ANALYSIS'||p.phase==='BLOCKED_BILLING'){
      if(!p.fileId)throw badRequest('Final output is missing.');
      const [existing]=rows<{id:string;status:string;error:string|null}>(await ctx.db.execute(sql`select id,status,error from ai_jobs where org_id=${ctx.orgId} and target_id=${p.fileId} and task='video_analyze' and status='COMPLETED' order by finished_at desc limit 1`));
      if(existing)next={...p,analysisId:existing.id,phase:'METADATA',detail:'Stored video analysis verified.'};
      else if(!prefs?.billablePostprocess)next={...p,phase:'BLOCKED_BILLING',detail:'Enable automatic billable analysis/SEO for this creator in Production runs.'};
      else if(!p.analysisId){
        const job=await queueVideoAnalysis(ctx,{fileId:p.fileId,acceptBillable:true,idempotencyKey:'production-analysis:'+j.id+':'+(p.attempt??1),productionJobId:j.id});
        next={...p,analysisId:job.id,phase:'ANALYSIS',detail:'Video analysis queued.'};
      }else{
        const [job]=rows<{status:string;error:string|null}>(await ctx.db.execute(sql`select status,error from ai_jobs where org_id=${ctx.orgId} and id=${p.analysisId}`));
        if(!job||job.status==='FAILED')throw badRequest(job?.error??'Video analysis record unavailable.');
        next={...p,phase:'ANALYSIS',detail:'Video analysis '+job.status.toLowerCase()+'.'};
      }
    }else if(p.phase==='METADATA'){
      if(!prefs?.billablePostprocess){next={...p,detail:'Automatic AI billing is disabled; enable it to continue SEO.'};}
      else{
        const pack=await createProductionMetadata(ctx,{fileId:p.fileId!,brandId:j.brandId,jobId:j.id,notes:j.title+'; use only observed movements.'});
        next={...p,metadata:pack.platforms,phase:'COVERS',detail:'All six platform SEO packages saved.'};
      }
    }else if(p.phase==='COVERS'){
      const [analysis]=rows<{output:{analysis?:{thumbnailCandidates?:{timestamp:string}[]}}}>(await ctx.db.execute(sql`select output from ai_jobs where id=${p.analysisId} and org_id=${ctx.orgId} and status='COMPLETED'`));
      const timestamp=coverSeconds(analysis?.output?.analysis?.thumbnailCandidates?.[0]?.timestamp);
      next={...p,covers:await makeCovers(ctx,j,p,timestamp),phase:'PREFILL',detail:'Original video-frame cover images generated for all six platforms.'};
    }else if(p.phase==='PREFILL'||p.phase==='AWAITING_ACCOUNTS'||p.phase==='READY'){
      const applied=await applyPublishing(ctx,j,p);
      next={...p,...applied,phase:applied.prefilled.length?'READY':'AWAITING_ACCOUNTS',detail:applied.prefilled.length?'Verified '+applied.prefilled.length+' connected publishing drafts. Unconnected platforms retain their packages.':'Platform packages and covers are saved; connect a social account for this creator to prefill.'};
    }
    const saved=await finish(ctx,j,lease,next);
    if(saved&&next.phase==='READY')await notify(ctx.db,{orgId:ctx.orgId,type:'production.ready',dedupeKey:'production.ready:'+j.id,title:j.title+' is ready for review',body:'Video, analysis, SEO and connected drafts are ready. Nothing was scheduled or published.',severity:'INFO',deepLink:'/production/'+j.projectId,sourceType:'generation_job',sourceId:j.id}).catch(()=>undefined);
  }catch(e){
    const message=redactSecrets(e instanceof Error?e.message:String(e));
    await finish(ctx,j,lease,{...p,phase:'FAILED',failedPhase:p.phase,detail:message});
    await notify(ctx.db,{orgId:ctx.orgId,type:'production.failed',dedupeKey:'production.failed:'+j.id+':'+p.phase+':'+(p.attempt??1),title:'Production needs attention',body:j.title+': '+message,severity:'WARNING',deepLink:'/today',sourceType:'generation_job',sourceId:j.id}).catch(()=>undefined);
  }
}
export async function runDueProduction(db:Db,env:ServiceEnv){
  await runDueLocalImages(db,env);
  await runDueProductionPlans(db,env);
  await reconcileProductionRuns(db,env);
  // A killed worker cannot safely repeat an uncertain provider request.
  await db.execute(sql`update generation_jobs set settings=jsonb_set(settings,'{postProduction}',(settings->'postProduction')||jsonb_build_object('phase','FAILED','failedPhase',settings->'postProduction'->>'phase','detail','Worker stopped during this stage. Review and explicitly retry; paid requests may have been charged.','lease',null,'leaseAt',null)),updated_at=now()
    where provider='comfyui-h3' and settings->'postProduction'->>'lease' is not null and (settings->'postProduction'->>'leaseAt')::timestamptz<now()-interval '12 minutes'`);
  const jobs=rows<Job>(await db.execute(sql`select j.id,j.org_id as "orgId",j.project_id as "projectId",p.brand_id as "brandId",p.title,j.status,j.settings,j.settings->>'productionRunId' as "runId",j.settings->'postProduction' as post
    from generation_jobs j join creative_projects p on p.id=j.project_id and p.org_id=j.org_id
    left join production_runs r on r.id::text=j.settings->>'productionRunId' and r.org_id=j.org_id
    where j.provider='comfyui-h3' and j.status='SUCCEEDED' and p.deleted_at is null and p.brand_id is not null and p.stage in ('DRAFT','IN_PROGRESS','READY')
      and (r.id is not null or j.settings->>'productionAdopted'='true') and (r.id is null or r.state='ACTIVE')
      and coalesce(j.settings->>'dispatchPaused','false')<>'true'
      and j.settings->'postProduction'->>'lease' is null
      and (coalesce(j.settings->'postProduction'->>'phase','WAIT_INDEX') not in ('READY','FAILED','STOPPED') or (j.settings->'postProduction'->>'phase'='READY' and exists(select 1 from social_accounts a join channels c on c.id=a.channel_id and c.org_id=a.org_id where a.org_id=j.org_id and c.brand_id=p.brand_id and a.active and a.deleted_at is null and c.deleted_at is null and a.platform::text in ('youtube','instagram','facebook','tiktok','threads','x') and not (coalesce(j.settings->'postProduction'->'prefilled','[]'::jsonb) ? a.id::text))))
    order by j.updated_at,j.id limit 10`));
  for(const j of jobs){
    const ctx=systemCtx({db,env},j.orgId);
    if((await runPrefs(ctx))[j.brandId]?.paused)continue;
    await advance(ctx,j);return {advanced:1};
  }
  return {advanced:0};
}
export async function controlProductionJob(ctx:Ctx,id:string,action:'adopt'|'pause'|'resume'|'stop'|'retry'|'cancel_render'){
  const j=await loadJob(ctx,id);
  if(action==='adopt'){
    if(!j.brandId||j.status!=='SUCCEEDED')throw badRequest('Adopt a completed creator video.');
    if(j.settings.productionAdopted===true||j.runId)return {accepted:true};
    await ctx.db.transaction(async tx=>{
      const [date]=rows<{day:string}>(await tx.execute(sql`select to_char(created_at at time zone 'America/Vancouver','YYYY-MM-DD') as day from generation_jobs where id=${id} and org_id=${ctx.orgId}`));
      if(!date)throw notFound('Job');
      await tx.execute(sql`insert into production_runs(org_id,brand_id,local_day,target,planning_state,planning_detail) values(${ctx.orgId},${j.brandId},${date.day}::date,2,'PLANNED','Owner adopted an existing completed render; source evidence predates run tracking.') on conflict(org_id,brand_id,local_day) do nothing`);
      const [run]=rows<{id:string;state:string}>(await tx.execute(sql`select id,state from production_runs where org_id=${ctx.orgId} and brand_id=${j.brandId} and local_day=${date.day}::date for update`));
      if(!run||run.state==='STOPPED')throw conflict('That daily run is stopped.');
      const [count]=rows<{n:number}>(await tx.execute(sql`select count(*)::int as n from generation_jobs where org_id=${ctx.orgId} and settings->>'productionRunId'=${run.id}`));
      if((count?.n??0)>=2)throw conflict('This daily run already has two videos.');
      await tx.execute(sql`update generation_jobs set settings=settings||${JSON.stringify({productionAdopted:true,productionRunId:run.id,postProduction:{phase:'WAIT_INDEX',attempt:1}})}::jsonb,updated_at=now() where id=${id} and org_id=${ctx.orgId}`);
      await runEvent(tx,ctx.orgId,run.id,'ADOPTED','Existing render adopted without regenerating.',id);
      await setAutomatedProjectStage(tx,ctx.orgId,j.projectId,'IN_PROGRESS','Existing rendered video adopted for post-production.');
    });
  }else if(action==='retry'){
    if(j.post?.phase!=='FAILED'||j.post.lease)throw conflict('Only an unsuccessful finished stage may be retried.');
    if(j.settings.productionStopped===true)throw conflict('This job was stopped.');
    const phase=j.post.failedPhase??'WAIT_INDEX';
    if(terminal.includes(phase))throw conflict('Cannot retry this stage.');
    const next:Post={...j.post,phase,detail:'Owner requested stage retry.',attempt:(j.post.attempt??1)+1,lease:null};
    if(phase==='ANALYSIS'||phase==='BLOCKED_BILLING')delete next.analysisId;
    if(phase==='WAIT_INDEX')await ctx.db.execute(sql`update generation_jobs set settings=settings||${JSON.stringify({outputScanRequestedAt:null,outputScanRetryAt:new Date().toISOString()})}::jsonb where id=${id} and org_id=${ctx.orgId}`);
    await ctx.db.execute(sql`update generation_jobs set settings=jsonb_set(settings,'{postProduction}',${JSON.stringify(next)}::jsonb,true),updated_at=now() where id=${id} and org_id=${ctx.orgId} and settings->'postProduction'->>'phase'='FAILED'`);
  }else if(action==='cancel_render'){
    // Cancel queued work atomically. For a running job only interrupt if the exact prompt is the sole running prompt.
    const removed=rows(await ctx.db.execute(sql`update generation_jobs set status='CANCELLED',error='Cancelled by owner before dispatch',finished_at=now(),updated_at=now() where id=${id} and org_id=${ctx.orgId} and status='QUEUED' returning id`));
    if(!removed.length){
      const [running]=rows<{promptId:string|null;baseUrl:string}>(await ctx.db.execute(sql`select j.prompt_id as "promptId",w.base_url as "baseUrl" from generation_jobs j join gpu_workers w on w.id::text=j.settings->>'workerId' and w.org_id=j.org_id where j.id=${id} and j.org_id=${ctx.orgId} and j.status='RUNNING'`));
      if(!running?.promptId)throw conflict('Render is not running or its submission is not yet confirmed. Pause or wait for reconciliation.');
      const promptId=running.promptId;
      const getQueue=async()=>{const res=await fetch(new URL('/queue',running.baseUrl),{signal:AbortSignal.timeout(8000)});if(!res.ok)throw conflict('Cannot verify GPU queue. No interrupt sent.');const q=await res.json() as {queue_running?:unknown[];queue_pending?:unknown[]};if(!Array.isArray(q.queue_running)||!Array.isArray(q.queue_pending))throw conflict('Invalid queue response.');return {running:q.queue_running,pending:q.queue_pending};};
      const has=(entry:unknown)=>Array.isArray(entry)&&entry[1]===promptId;
      const q=await getQueue();
      if(q.pending.some(has)){
        const res=await fetch(new URL('/queue',running.baseUrl),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({delete:[promptId]}),signal:AbortSignal.timeout(8000)});if(!res.ok)throw conflict('Queue cancellation was refused.');
      }else if(q.running.length===1&&q.running.some(has)){
        const res=await fetch(new URL('/interrupt',running.baseUrl),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt_id:promptId}),signal:AbortSignal.timeout(8000)});if(!res.ok)throw conflict('Interrupt was refused.');
      }else throw conflict('Target prompt is not uniquely identifiable in the queue. No interrupt sent.');
      // Request acknowledgement is not completion. Keep RUNNING until history or queue confirms.
      await ctx.db.execute(sql`update generation_jobs set settings=settings||'{"cancelRequested":true,"dispatchPaused":true}'::jsonb,updated_at=now() where id=${id} and org_id=${ctx.orgId} and status='RUNNING'`);
    }
  }else{
    if(action==='resume'&&j.settings.productionStopped===true)throw conflict('Stopped stages cannot be resumed.');
    const paused=action!=='resume';
    await ctx.db.execute(sql`update generation_jobs set settings=settings||${JSON.stringify({dispatchPaused:paused,...(action==='stop'?{productionStopped:true}:{})})}::jsonb,
      status=case when ${action==='stop'} and status='QUEUED' then 'CANCELLED'::generation_status else status end,finished_at=case when ${action==='stop'} and status='QUEUED' then now() else finished_at end,updated_at=now()
      where id=${id} and org_id=${ctx.orgId} and (${action!=='resume'} or coalesce(settings->>'productionStopped','false')<>'true')`);
  }
  await runEvent(ctx.db,ctx.orgId,j.runId,'OWNER_'+action.toUpperCase(),'Owner requested '+action+'.',j.id);
  await audit(ctx,'production.job.'+action,{type:'generation_job',id});
  return {accepted:true};
}
