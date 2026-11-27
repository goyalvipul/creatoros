'use client';

import Link from 'next/link';
import {Activity,ChevronDown,FileText,Pause,Play,RefreshCw,Square,Workflow} from 'lucide-react';
import {useState} from 'react';
import {useApi,post} from '@/lib/api';
import {ActionButton} from '@/components/ui';

type Post={phase:string;detail?:string;lease?:string|null;fileId?:string;itemId?:string;covers?:string[];prefilled?:string[];missingPlatforms?:string[];humanReviewRequired?:boolean;unresolvedChecks?:string[];qualityVerdict?:string};
type Job={id:string;projectId:string;title:string;brandId:string;stage:string;status:string;error:string|null;runId:string|null;worker:string|null;progress?:{phase:string;detail:string};scanStatus?:string;post?:Post;paused:boolean;superseded?:boolean;createdAt:string;finishedAt?:string};
type Run={id:string;brandId:string;brandName:string;localDay:string;target:number;state:string;planningState:string;planningDetail:string|null};
type Event={id:number;runId:string;jobId?:string;stage:string;detail:string;createdAt:string};
type Plan={id:string;runId:string;projectId:string;state:string;attempt:number;jobId?:string;detail?:string;quality?:{verdict?:string;corrections?:string[];semantic?:{checks?:{criterion:string;status:string;evidence:string}[]}};reviewStage?:string;canRetryInspection?:boolean;images?:{id:string;state:string;fileId?:string;error?:string}[];updatedAt:string};
type Board={runs:Run[];jobs:Job[];events:Event[];plans?:Plan[];brands:{id:string;name:string}[];preferences:Record<string,{paused?:boolean;billablePostprocess?:boolean}>};
const root='/comfy/production-runs';
const words=(s:string)=>s.replace(/_/g,' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
const time=(s:string)=>new Date(s).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'America/Vancouver'});
function saveLogs(run:Run,jobs:Job[],events:Event[]){
  const blob=new Blob([JSON.stringify({run,jobs,events},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='production-'+run.localDay+'-'+run.id.slice(0,8)+'.json';a.click();URL.revokeObjectURL(url);
}
function jobLabel(j:Job){
  if(j.superseded)return 'Rejected attempt · retained';
  if(j.status==='FAILED'||j.status==='CANCELLED')return words(j.status);
  if(j.paused)return 'Paused';
  if(j.status==='SUCCEEDED')return j.post?.phase==='READY'&&j.post.humanReviewRequired?'Ready for human review':j.post?words(j.post.phase):'Rendered · not enrolled';
  return j.status==='RUNNING'?'Rendering':'Waiting for GPU';
}
function JobCard({j,refresh}:{j:Job;refresh:()=>Promise<unknown>}){
  const control=async(action:string)=>{await post('/comfy/production-jobs/'+j.id+'/control',{action});await refresh();};
  const phase=j.post?.phase;
  const failed=j.status==='FAILED'||phase==='FAILED',ready=phase==='READY';
  return <article className="rounded-xl border border-border bg-panel p-3 min-w-0">
    <div className="flex flex-wrap justify-between gap-2"><Link href={'/production/'+j.projectId} className="min-w-0 break-words font-semibold hover:underline">{j.title}</Link><span className={'rounded-full px-2 py-1 text-[11px] font-medium '+(failed?'bg-bad/10 text-bad':ready?'bg-ok/10 text-ok':'bg-panel2 text-muted')}>{jobLabel(j)}</span></div>
    <p className="mt-1 text-xs text-muted">{j.worker??'GPU not recorded'} · Project {words(j.stage)} · Job {j.id.slice(0,8)}</p>
    <div className="mt-2 grid grid-cols-5 gap-1" aria-label="Verified stages">
      {[j.status==='SUCCEEDED',!!j.post?.fileId,!!phase&&['METADATA','COVERS','PREFILL','AWAITING_ACCOUNTS','READY'].includes(phase),!!j.post?.covers?.length,ready].map((done,i)=><div key={i} className="min-w-0"><div className={'h-1.5 rounded-full '+(done?'bg-ok':'bg-panel2')}/><div className="mt-1 text-[10px] text-muted">{['Render','Index','Analysis','Cover','Draft'][i]}</div></div>)}
    </div>
    <p className={'mt-2 text-xs '+(failed?'text-bad':'text-muted')}>{j.error??j.post?.detail??j.progress?.detail??'Awaiting processing.'}{j.scanStatus?' · '+words(j.scanStatus):''}</p>
    {j.post?.humanReviewRequired&&<p className="mt-1 text-xs font-medium text-muted">Human review required{j.post.unresolvedChecks?.length?': '+j.post.unresolvedChecks.join(', '):'.'} Not creative approval.</p>}
    {!!j.post?.missingPlatforms?.length&&<p className="mt-1 text-xs text-muted">Not connected: {j.post.missingPlatforms.join(', ')}. Packages remain saved.</p>}
    <div className="mt-3 flex flex-wrap gap-2">{j.superseded&&<span className="text-xs text-muted">Preserved for review; no automatic publishing drafts.</span>}
      {!j.runId&&j.status==='SUCCEEDED'&&<ActionButton size="sm" confirm="Continue post-processing this existing render without making another video? Billable provider calls still require creator authorization." onAction={()=>control('adopt')}>Process existing video</ActionButton>}
      {!j.superseded&&(j.status==='QUEUED'||(j.status==='SUCCEEDED'&&!ready&&phase!=='STOPPED'&&!!j.runId))?<ActionButton size="sm" variant="ghost" onAction={()=>control(j.paused?'resume':'pause')}>{j.paused?'Resume':'Pause'}</ActionButton>:null}
      {phase==='FAILED'&&<ActionButton size="sm" confirm="Retry only the failed stage? A provider request may be charged again." onAction={()=>control('retry')}>Retry stage</ActionButton>}
      {(j.status==='QUEUED'||j.status==='RUNNING')&&<ActionButton size="sm" variant="danger" confirm="Cancel this exact render? If running, this sends an interrupt only after its prompt is identified as the sole running prompt. Other clients may change the queue concurrently." onAction={()=>control('cancel_render')}>Cancel render</ActionButton>}
      {!j.superseded&&j.status==='SUCCEEDED'&&!ready&&!!j.runId&&!j.paused&&<ActionButton size="sm" variant="ghost" confirm="Stop the remaining stages? Any provider call already sent may finish." onAction={()=>control('stop')}>Stop stages</ActionButton>}
      {j.post?.itemId&&<Link className="inline-flex items-center px-2 text-xs font-medium text-accent hover:underline" href="/publishing">Publishing</Link>}
    </div>
  </article>;
}
export function ProductionRuns({enabled,compact=false}:{enabled:boolean;compact?:boolean}){
  const board=useApi<Board>(enabled?root:null,{refreshInterval:10000,refreshWhenHidden:false});
  const [selected,setSelected]=useState<string|null>(null);
  const [showConfig,setShowConfig]=useState(false);
  if(!enabled)return null;
  const d=board.data;
  const visible=compact?d?.runs.slice(0,2):d?.runs;
  const orphan=d?.jobs.filter(j=>!j.runId)??[];
  return <section id="production-automations" className="rounded-[18px] border border-border bg-panel p-4 md:p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-panel2 text-accent"><Workflow className="size-5" aria-hidden/></div><div><h2 className="font-semibold">Production automations</h2><p className="text-xs text-muted">Daily runs · Vancouver time · no automatic publishing</p></div></div>
      <div className="flex items-center gap-2"><ActionButton size="sm" variant="ghost" aria-label="Refresh production runs" onAction={async()=>{await board.mutate();}}><RefreshCw className="size-4" aria-hidden/></ActionButton>{compact?<Link className="text-xs text-accent font-semibold" href="/production-runs">Run history</Link>:<ActionButton size="sm" variant="ghost" onAction={async()=>{setShowConfig(!showConfig);}}>Settings</ActionButton>}</div>
    </div>
    {board.error&&<p className="text-xs text-bad">Cannot load production status: {board.error.message}</p>}
    {!d&&!board.error&&<p className="text-sm text-muted">Loading production history…</p>}
    {!compact&&showConfig&&d&&<div className="rounded-xl border border-border p-3 space-y-3"><h3 className="font-semibold text-sm">Creator automation settings</h3><p className="text-xs text-muted">Pausing a creator blocks new daily runs and further queued stages. The external ChatGPT schedule is managed in ChatGPT. Automatic analysis and SEO use your Gemini API and the AI usage limits; covers use local FFmpeg.</p>{d.brands.map(b=>{
      const pref=d.preferences[b.id]??{};
      const change=async(p:Record<string,boolean>)=>{await post('/comfy/production-preferences/'+b.id,p);await board.mutate();};
      return <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"><span className="font-medium text-sm">{b.name}</span><div className="flex flex-wrap gap-2"><ActionButton size="sm" variant="ghost" onAction={()=>change({paused:!pref.paused})}>{pref.paused?'Resume future runs':'Pause future runs'}</ActionButton><ActionButton size="sm" confirm={pref.billablePostprocess?'Disable automatic paid provider calls?':'Authorize automatic Gemini video analysis and SEO for this creator within the existing AI limits?'} onAction={()=>change({billablePostprocess:!pref.billablePostprocess})}>{pref.billablePostprocess?'Disable paid AI':'Enable paid AI'}</ActionButton></div></div>;
    })}</div>}
    {visible?.map(r=>{
      const jobs=d!.jobs.filter(j=>j.runId===r.id),events=d!.events.filter(e=>e.runId===r.id),rendered=jobs.filter(j=>j.status==='SUCCEEDED'&&!j.superseded).length,ready=jobs.filter(j=>j.post?.phase==='READY'&&!j.superseded).length;
      const state=r.state!=='ACTIVE'?words(r.state):ready>=r.target?'Ready for review':jobs.some(j=>j.status==='FAILED'||j.post?.phase==='FAILED')?'Needs attention':r.planningState==='BLOCKED'||r.planningState==='FAILED'?words(r.planningState):jobs.some(j=>j.status==='RUNNING')?'Rendering':jobs.some(j=>j.status==='QUEUED')?'Queued':jobs.length?'Post-processing':words(r.planningState);
      const control=async(action:string)=>{await post(root+'/'+r.id+'/control',{action});await board.mutate();};
      return <article key={r.id} className="rounded-xl border border-border p-3.5 space-y-3">
        <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{r.brandName}</h3><p className="text-xs text-muted">{r.localDay} · Daily production</p></div><span className={'self-start rounded-full px-2.5 py-1 text-xs font-medium '+(ready>=r.target?'bg-ok/10 text-ok':state==='Needs attention'||state==='Blocked'?'bg-warn/10 text-warn':'bg-panel2 text-muted')}>{state}</span></div>
        <div className="grid grid-cols-3 gap-2">{[['Submitted',jobs.length+'/'+r.target],['Rendered',rendered+'/'+r.target],['Ready',ready+'/'+r.target]].map(([name,value])=><div key={name} className="rounded-lg bg-panel2 px-3 py-2"><div className="text-xs text-muted">{name}</div><div className="font-semibold text-xl tabular-nums">{value}</div></div>)}</div>
        {r.planningDetail&&jobs.length<r.target&&<p className="text-xs text-muted whitespace-pre-wrap line-clamp-4">{r.planningDetail}</p>}
        <div className="grid gap-2 md:grid-cols-2">{d!.plans?.filter(p=>p.runId===r.id).map(p=><div key={p.id} className="rounded-lg border border-border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><Link href={'/production/'+p.projectId} className="font-semibold hover:underline">Executable plan {p.id.slice(0,8)}</Link><span>{words(p.state)} · attempt {p.attempt}</span></div><p className="mt-1 text-xs text-muted">{p.detail}</p>{p.images?.map(i=><p key={i.id} className="mt-1 text-xs text-muted">Asset {i.id.slice(0,8)} · {words(i.state)}{i.fileId?' · indexed '+i.fileId.slice(0,8):''}{i.error?' · '+i.error:''}</p>)}{p.quality?.corrections?.map((c,i)=><p key={i} className="mt-1 text-xs text-bad">{c}</p>)}{p.quality?.semantic?.checks&&<details className="mt-2"><summary className="cursor-pointer text-xs font-medium">Quality evidence</summary>{p.quality.semantic.checks.map(c=><p key={c.criterion} className="mt-1 text-xs text-muted">{c.criterion}: {c.status} — {c.evidence}</p>)}</details>}{p.state==='REVIEW'&&p.reviewStage&&<div className="mt-2 flex flex-wrap gap-2">{p.reviewStage!=='QUALITY'&&<ActionButton size="sm" confirm="Resume only the safely recoverable saved stage?" onAction={async()=>{await post('/comfy/production-plans/'+p.id+'/recover',{action:'resume'});await board.mutate();}}>Resume plan</ActionButton>}{p.canRetryInspection&&<ActionButton size="sm" confirm="Retry this inspection once? Gemini may charge for another review." onAction={async()=>{await post('/comfy/production-plans/'+p.id+'/recover',{action:'retry_inspection'});await board.mutate();}}>Retry inspection</ActionButton>}</div>}</div>)}{jobs.map(j=><JobCard key={j.id} j={j} refresh={board.mutate}/>)}</div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton size="sm" variant="ghost" onAction={async()=>{setSelected(selected===r.id?null:r.id);}}><FileText className="mr-1 size-3.5" aria-hidden/> Logs <ChevronDown className="ml-1 size-3" aria-hidden/></ActionButton>
          {r.state!=='STOPPED'&&ready<r.target&&<><ActionButton size="sm" variant="ghost" onAction={()=>control(r.state==='PAUSED'?'resume':'pause')}>{r.state==='PAUSED'?<Play className="mr-1 size-3.5"/>:<Pause className="mr-1 size-3.5"/>}{r.state==='PAUSED'?'Resume':'Pause'}</ActionButton><ActionButton size="sm" variant="danger" confirm="Stop this run and cancel queued renders? Active rendering can be cancelled separately; already-sent AI requests may finish." onAction={()=>control('stop')}><Square className="mr-1 size-3.5"/> Stop run</ActionButton></>}
        </div>
        {selected===r.id&&<RunLogs run={r} fallbackJobs={jobs} fallbackEvents={events}/>}
      </article>;
    })}
    {d&&!d.runs.length&&<p className="text-sm text-muted">No tracked daily runs yet. Updated ChatGPT automation will register a run before research. Existing rendered videos can be processed below.</p>}
    {orphan.length>0&&<details className="border-t border-border pt-2"><summary className="cursor-pointer text-sm font-medium text-muted">Existing H3 jobs without a daily run ({orphan.length})</summary><div className="mt-3 grid gap-2 md:grid-cols-2">{orphan.slice(0,compact?4:100).map(j=><JobCard key={j.id} j={j} refresh={board.mutate}/>)}</div></details>}
    {!compact&&<p className="text-xs text-muted">Run now for fresh research: use the existing ChatGPT automation. Once registered, pause/stop and recovery are controlled here. No new render or social post is started by viewing this page.</p>}
  </section>;
}
function RunLogs({run,fallbackJobs,fallbackEvents}:{run:Run;fallbackJobs:Job[];fallbackEvents:Event[]}){
  const detail=useApi<Board>(root+'/'+run.id,{refreshInterval:10000});
  const events=detail.data?.events??fallbackEvents,jobs=detail.data?.jobs??fallbackJobs;
  return <div className="rounded-lg bg-panel2 p-3 space-y-2">
    <div className="flex justify-between items-center gap-2"><span className="text-xs font-medium">Execution history · Vancouver</span><ActionButton size="sm" variant="ghost" onAction={async()=>saveLogs(run,jobs,events)}>Download JSON</ActionButton></div>
    <div className="max-h-72 overflow-y-auto space-y-2">{events.length?events.map(e=><div key={e.id} className="flex gap-2 text-xs"><Activity className="size-3.5 shrink-0 text-muted" aria-hidden/><div className="min-w-0"><p className="text-muted">{time(e.createdAt)} · {words(e.stage)}{e.jobId?' · '+e.jobId.slice(0,8):''}</p><p className="whitespace-pre-wrap break-words">{e.detail}</p></div></div>):<p className="text-xs text-muted">No events recorded.</p>}</div>
  </div>;
}
