'use client';

import Link from 'next/link';
import { Activity, ChevronDown, Cpu, RefreshCw, RotateCcw, Server, HardDrive, Thermometer } from 'lucide-react';
import { useApi, post, refresh } from '@/lib/api';
import { ActionButton } from '@/components/ui';

type Memory = {usedBytes:number;totalBytes:number};
type Job = {id:string;projectId:string|null;title:string|null;provider:string;status:string;phase:string|null;detail:string|null;progress:{value:number;max:number}|null;startedAt:string|null;createdAt:string};
type Machine = {id:string;label:string;role:string;expectedVramGb:number|null;state:'available'|'busy'|'unreachable'|'unknown'|'disabled';counts:{running:number;pending:number}|null;vram:Memory|null;ram:Memory|null;checkedAt:string;hardware?:{sampledAt:string;cpuPct:number|null;gpuPct:number|null;gpuTempC:number|null}|null;agent:{name:string;online:boolean;seenAt:string|null;cpuPct:number|null}|null;jobs:Job[];jobCount:number;restart:{taskId:string;label:string;deviceName:string;status:string|null;error?:string|null;taskStatus?:string;canRestart:boolean}|null};
type Monitor = {machines:Machine[];storageAgents:{id:string;name:string;online:boolean;seenAt:string|null;scanning:boolean}[];unassignedJobCount:number;sampledAt:string};
const path='/comfy/machine-monitor';
const labels={available:'Queue free',busy:'Busy',unreachable:'ComfyUI unreachable',unknown:'Status unknown',disabled:'Disabled'};
const tones={available:'text-ok bg-ok/10',busy:'text-warn bg-warn/10',unreachable:'text-bad bg-bad/10',unknown:'text-muted bg-panel2',disabled:'text-muted bg-panel2'};
function gb(value:number){return (value/1024**3).toFixed(1);}
function Meter({label,memory}:{label:string;memory:Memory|null}){
  const pct=memory?Math.min(100,Math.max(0,100*memory.usedBytes/memory.totalBytes)):null;
  return <div className="min-w-0">
    <div className="flex items-center justify-between gap-2 text-[11px]"><span className="text-muted">{label}</span><span className="font-semibold tabular-nums">{memory?gb(memory.usedBytes)+' / '+gb(memory.totalBytes)+' GB':'—'}</span></div>
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel2" role={pct===null?undefined:'meter'} aria-label={label+' used'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct??undefined}>
      {pct!==null&&<div className={'h-full rounded-full transition-[width] duration-500 '+(pct>=90?'bg-warn':'bg-ok')} style={{width:pct+'%'}}/>}
    </div>
  </div>;
}
function Utilization({label,value}:{label:string;value:number|null}){
  return <div className="min-w-0">
    <div className="flex items-center justify-between gap-2 text-[11px]"><span className="text-muted">{label}</span><span className="font-semibold tabular-nums">{value===null?'—':Math.round(value)+'%'}</span></div>
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel2" role={value===null?undefined:'meter'} aria-label={label+' utilization'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value??undefined}>
      {value!==null&&<div className={'h-full rounded-full transition-[width] duration-500 '+(value>=90?'bg-warn':'bg-ok')} style={{width:value+'%'}}/>}
    </div>
  </div>;
}
function JobRow({job}:{job:Job}){
  const label=job.title??(job.provider==='comfyui-h3'?'MiniMax H3 job':job.provider);
  const progress=job.progress;
  return <div className="min-w-0">
    <div className="flex items-center gap-2">
      <Activity className="size-3.5 shrink-0 text-accent" aria-hidden/>
      {job.projectId?<Link className="truncate text-sm font-semibold hover:underline" href={'/production/'+job.projectId} title={label}>{label}</Link>:<span className="truncate text-sm font-semibold">{label}</span>}
    </div>
    <p className="mt-1 text-xs text-muted">{job.status==='QUEUED'?'Queued':job.phase??'Running'}{job.detail?' · '+job.detail:''}</p>
    {progress&&<div className="mt-1.5 flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-panel2 overflow-hidden"><div className="h-full rounded-full bg-ok" style={{width:100*progress.value/progress.max+'%'}}/></div><span className="text-[10px] tabular-nums text-muted">{progress.value}/{progress.max} steps</span></div>}
  </div>;
}
export function MachineOverview({enabled}:{enabled:boolean}){
  const monitor=useApi<Monitor>(enabled?path:null,{refreshInterval:10000,revalidateOnFocus:true,refreshWhenHidden:false,keepPreviousData:false});
  if(!enabled)return null;
  const d=monitor.data;
  const stale=!!monitor.error||!!(d&&Date.now()-Date.parse(d.sampledAt)>30000);
  const active=d?.machines.reduce((n,m)=>n+m.jobCount,0)??0;
  return <section className="rounded-[18px] border border-border bg-panel p-4 md:p-5" aria-label="Production machines">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-panel2 text-accent"><Cpu className="size-5" aria-hidden/></div><div><h2 className="font-semibold">Production machines</h2><p className="text-xs text-muted">{d&&!stale?active+' active Kemokem job'+(active===1?'':'s')+' · live queue & memory':stale?'Live readings unavailable':'Checking worker availability…'}</p></div></div>
      <div className="flex items-center gap-2"><ActionButton variant="ghost" size="sm" aria-label="Refresh machine readings" onAction={async()=>{await monitor.mutate();}}><RefreshCw className="size-4" aria-hidden/></ActionButton><Link href="/comfy" className="inline-flex min-h-10 items-center text-xs font-semibold text-accent hover:underline">Open studio</Link></div>
    </div>
    {stale&&<p role="status" className="mt-3 rounded-lg border border-border px-3 py-2 text-xs text-muted">Readings are stale. A registered task can still be restarted; check for active work before confirming.</p>}
    {!d&&!monitor.error&&<div className="mt-4 grid gap-3 sm:grid-cols-2">{[0,1].map(i=><div key={i} className="h-32 animate-pulse rounded-xl bg-panel2"/>)}</div>}
    {!d&&monitor.error&&<p className="mt-3 text-sm text-muted">{monitor.error.message}</p>}
    {d&&d.machines.length===0&&<p className="mt-3 text-sm text-muted">No GPU workers configured. <Link href="/comfy" className="text-accent underline">Configure in studio</Link>.</p>}
    {d&&<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-2">
      {d.machines.map(m=>{
        const restarting=m.restart?.status==='PENDING'||m.restart?.status==='RUNNING';
        const hardware=!stale&&m.hardware&&Date.now()-Date.parse(m.hardware.sampledAt)<=90000?m.hardware:null;
        const temp=hardware?.gpuTempC??null;
        const restartLabel='Restart ComfyUI';
        const queueRisk=stale||!m.counts||m.state==='busy'||m.jobCount>0||d.unassignedJobCount>0;
        const restartStatus=restarting?(m.restart?.status==='RUNNING'?'Restart in progress':'Restart queued'):m.restart?.status==='SUCCEEDED'?'Last restart reported successful':m.restart?.status==='FAILED'?'Last restart failed':'Managed Windows task';
        return <article key={m.id} className="min-w-0 rounded-xl border border-border bg-panel p-3.5 md:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h3 className="font-semibold">{m.label}</h3><p className="mt-0.5 text-xs text-muted">{m.expectedVramGb?m.expectedVramGb+' GB · ':''}{m.agent?m.agent.name+' · agent '+(m.agent.online?'online':'offline'):'No verified agent match'}</p></div>
            <span className={'rounded-full px-2.5 py-1 text-[11px] font-semibold '+(restarting?tones.busy:stale?tones.unknown:tones[m.state])}>{restarting?'Restarting':stale?'Stale':labels[m.state]}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Utilization label="CPU" value={hardware?.cpuPct??null}/>
            <Utilization label="GPU" value={hardware?.gpuPct??null}/>
            <Meter label="RAM used" memory={stale?null:m.ram}/>
            <Meter label="VRAM used" memory={stale?null:m.vram}/>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted"><span>{!stale&&m.counts?m.counts.running+' running · '+m.counts.pending+' queued':'Queue counts unavailable'}</span><span className={'inline-flex items-center gap-1 tabular-nums '+(temp!==null&&temp>=85?'text-warn':'text-muted')} title="NVIDIA GPU core temperature"><Thermometer className="size-3.5" aria-hidden/> GPU {temp===null?'—':Math.round(temp)+'°C'}</span></div>
          {!stale&&!hardware&&<p className="mt-1 text-[11px] text-muted">Hardware telemetry unavailable · update or reconnect scanner agent.</p>}
          <div className="mt-3 min-h-[56px] rounded-lg bg-panel2 px-3 py-2.5">
            {stale?<p className="text-xs text-muted">Awaiting fresh readings</p>:m.jobs[0]?<><JobRow job={m.jobs[0]}/>{m.jobCount>1&&<p className="mt-1 text-xs text-muted">+{m.jobCount-1} additional active jobs</p>}</>:<p className="text-xs text-muted">{m.state==='busy'?'ComfyUI queue contains work outside a known Kemokem job.':m.state==='available'?'No active generation in the queue.':'Current activity unavailable.'}</p>}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className={'text-[11px] '+(m.restart?.status==='FAILED'?'text-bad':'text-muted')}>{m.restart?restartStatus:'Restart task not matched'}</span>
            {m.restart?<ActionButton variant="ghost" size="sm" confirm={'Stop and start '+m.restart.label+' on '+m.restart.deviceName+'?'+(queueRisk?' The queue is busy or cannot be verified. Restart may interrupt running or queued work.':'')+(restarting?' A restart is already pending; the existing request will be reused.':'')} onAction={async()=>{await post(path+'/'+m.id+'/restart',{taskId:m.restart!.taskId});await Promise.all([monitor.mutate(),refresh('/comfy/windows-tasks')]);}} success="Restart request accepted. Waiting for the Windows agent."><RotateCcw className="mr-1.5 size-3.5" aria-hidden/>{restartLabel}</ActionButton>:<Link href="/comfy" className="text-xs font-semibold text-accent hover:underline">Set up restart</Link>}
          </div>
          {m.restart?.error&&<p role="status" className="mt-1 text-[11px] text-bad">{m.restart.error}</p>}
          {m.restart&&!m.agent?.online&&<p className="mt-1 text-[11px] text-muted">Agent offline · restart waits for the PC to reconnect.</p>}
          {m.restart&&!stale&&m.state==='unreachable'&&!restarting&&m.agent?.online&&<p className="mt-1 text-[11px] text-muted">ComfyUI is unreachable. Restart through the Windows task.</p>}
        </article>;
      })}
    </div>}
    {!!d?.unassignedJobCount&&<p className="mt-3 text-xs text-warn">{d.unassignedJobCount} active job(s) lack a verified worker association. Restart is blocked.</p>}
    {!!d?.storageAgents.length&&<details className="mt-3 border-t border-border pt-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-medium text-muted"><HardDrive className="size-3.5" aria-hidden/>Storage & scanner agents<span className="ml-auto">{stale?'Stale':d.storageAgents.filter(a=>a.online).length+'/'+d.storageAgents.length+' online'}</span><ChevronDown className="size-3.5" aria-hidden/></summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{d.storageAgents.map(a=><div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-panel2 px-3 py-2 text-xs"><span className="flex min-w-0 items-center gap-2"><Server className="size-3.5 shrink-0" aria-hidden/><span className="truncate">{a.name}</span></span><span className={!stale&&a.online?'text-ok':'text-muted'}>{stale?'Unknown':a.online?(a.scanning?'Scanning':'Online'):'Offline'}</span></div>)}</div>
    </details>}
    <p className="mt-2 text-[10px] text-muted">Queue refreshes every 10 seconds; hardware samples arrive with agent heartbeats (normally 30 seconds). GPU temperature is core temperature. Queue free does not guarantee system idle.</p>
  </section>;
}
