'use client';
import { useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { post,useApi } from '@/lib/api';
const path='/integrations/ai-gateway/agent-studio';
type Config={name:string;brandId:string;subscriptionId:string;workflow:'STRATEGY'|'SCRIPT'|'IMAGE'|'H3_SHORT'|'LTX_SHORT';schedule:{kind:'MANUAL'|'DAILY';time:string};
 instructions:string;skills:{name:string;instructions:string}[];memory:{key:string;value:string}[];projectId:string|null;workerId:string|null;
 aspect:'9:16'|'16:9'|'1:1';durationSec:number;research:'NONE'|'VIDIQ';researchQuery?:string;vidiqWatch?:boolean;acceptHostCreditRisk?:boolean;dailyTasks:number;dailyImages:number;vidiqCredits:number;maxRegenerations?:0|1;ltx?:{audioFileId:string;audioStartSec:number;loraName:string;loraStrength:number}};
type Agent={id:string;name:string;enabled:boolean;revision:number;config:Config;lastError?:string|null};
type Run={id:string;agentId:string;slot:string;revision:number;state:string;stage:number;detail:string|null;projectId:string|null;jobId:string|null;fileId:string|null};
type Board={exclusive:boolean;agents:Agent[];runs:Run[];usage:{agentId:string;tasks:number;images:number;vidiqReserved:number}[];
 tasks:{id:string;runId:string;stageKey:string;state:string;progress:string|null;errorCode:string|null;result:unknown}[];
 events:{id:string;runId:string;state:string;stage:number;detail:string;createdAt:string}[];
 brands:{id:string;name:string}[];projects:{id:string;title:string;brandId:string}[];workers:{id:string;name:string}[];subscriptions:{id:string;expiresAt:string}[]};
const blank:Config={name:'',brandId:'',subscriptionId:'',workflow:'SCRIPT',schedule:{kind:'MANUAL',time:'01:00'},instructions:'',skills:[],memory:[],
 projectId:null,workerId:null,aspect:'9:16',durationSec:12,research:'NONE',dailyTasks:6,dailyImages:2,vidiqCredits:0,maxRegenerations:0};
const field='block w-full rounded border border-border bg-transparent p-2 text-sm';
export function AgentStudioCard(){
 const {data,error,mutate}=useApi<Board>(path,{refreshInterval:5000});
 const [config,setConfig]=useState<Config>(blank);
 const [editId,setEditId]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [failure,setFailure]=useState('');
 const [open,setOpen]=useState(false);
 function patch<K extends keyof Config>(key:K,value:Config[K]){setConfig(old=>({...old,[key]:value}));}
 const perform=async(suffix:string,body:unknown={})=>{
  setBusy(true);setFailure('');
  try{await post(path+suffix,body);await mutate();return true;}
  catch(e){setFailure(e instanceof Error?e.message:'Request failed.');return false;}
  finally{setBusy(false);}
 };
 const reset=()=>{setConfig({...blank,subscriptionId:data?.subscriptions[0]?.id??''});setEditId(null);setOpen(true);};
 const save=async()=>{if(await perform('/agents'+(editId?'/'+editId:''),config))setOpen(false);};
 const flip=async()=>{
  const enabled=!data?.exclusive;
  if(!window.confirm(enabled?'Enable exclusive agent execution? Existing interactive hosted MCP operations will be disabled. Stop the legacy ChatGPT producer first.':'Restore interactive access? All agents will be disabled.'))return;
  await perform('/exclusive',{enabled});
 };
 return <section className="mt-4 space-y-4 border-t border-border pt-3" aria-labelledby="agent-studio">
  <div className="flex flex-wrap items-center gap-2">
   <h3 id="agent-studio" className="font-semibold">Agent Studio</h3>
   <Badge tone={data?.exclusive?'ok':'warn'}>{data?.exclusive?'Exclusive execution':'Interactive mode'}</Badge>
  </div>
  <p className="text-sm text-muted">Native Vancouver-time scheduling, revision-pinned skills and memory, and durable creative runs. H3 and audio-conditioned LTX create one short per daily run. No paid fallback or automatic publication. Optional vidIQ research reserves credits locally; the external provider is not hard-capped by Kemokem.</p>
  {error&&<p role="alert" className="text-bad text-sm">{error.message}</p>}
  {failure&&<p role="alert" className="text-bad text-sm">{failure}</p>}
  {data&&<>
   <div className="grid gap-2 sm:grid-cols-3">
    <div className="rounded border border-border p-3"><p className="text-muted text-xs">Enabled agents</p><strong>{data.agents.filter(a=>a.enabled).length}</strong></div>
    <div className="rounded border border-border p-3"><p className="text-muted text-xs">Active runs</p><strong>{data.runs.filter(r=>r.state==='ACTIVE').length}</strong></div>
    <div className="rounded border border-border p-3"><p className="text-muted text-xs">Blocked runs</p><strong>{data.runs.filter(r=>r.state==='BLOCKED').length}</strong></div>
   </div>
   <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>void flip()}>{data.exclusive?'Restore interactive mode':'Enable exclusive mode'}</Button><Button disabled={busy} onClick={reset}>New agent</Button></div>
   {open&&<div className="space-y-3 rounded border border-border p-3">
    <h4 className="font-semibold">{editId?'Edit agent revision':'New agent'}</h4>
    <div className="grid gap-2 sm:grid-cols-2">
     <label className="text-sm">Name<input className={field} value={config.name} onChange={e=>patch('name',e.target.value)}/></label>
     <label className="text-sm">Creator<select className={field} value={config.brandId} disabled={!!editId} onChange={e=>setConfig(c=>({...c,brandId:e.target.value,projectId:null}))}><option value="">Select creator</option>{data.brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
     <label className="text-sm">Subscription<select className={field} value={config.subscriptionId} onChange={e=>patch('subscriptionId',e.target.value)}><option value="">Select production subscription</option>{data.subscriptions.map(s=><option key={s.id} value={s.id}>{s.id.slice(0,12)}</option>)}</select></label>
     <label className="text-sm">Workflow<select className={field} value={config.workflow} onChange={e=>setConfig(c=>({...c,workflow:e.target.value as Config['workflow'],projectId:null,maxRegenerations:0,ltx:e.target.value==='LTX_SHORT'?(c.ltx??{audioFileId:'',audioStartSec:0,loraName:'',loraStrength:0.75}):undefined}))}><option value="STRATEGY">Content strategy</option><option value="SCRIPT">Strategy and script</option><option value="IMAGE">Character/scene image</option><option value="H3_SHORT">H3 short → READY</option><option value="LTX_SHORT">LTX audio-conditioned short → READY</option></select></label>
     <label className="text-sm">Schedule<select className={field} value={config.schedule.kind} onChange={e=>patch('schedule',{...config.schedule,kind:e.target.value as Config['schedule']['kind']})}><option value="MANUAL">Manual</option><option value="DAILY">Daily</option></select></label>
     <label className="text-sm">Time (Vancouver)<input className={field} type="time" value={config.schedule.time} onChange={e=>patch('schedule',{...config.schedule,time:e.target.value})}/></label>
     {['H3_SHORT','LTX_SHORT'].includes(config.workflow)?<label className="text-sm">GPU worker<select className={field} value={config.workerId??''} onChange={e=>patch('workerId',e.target.value||null)}><option value="">Select worker</option>{data.workers.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>:<label className="text-sm">Draft project<select className={field} value={config.projectId??''} onChange={e=>patch('projectId',e.target.value||null)}><option value="">None</option>{data.projects.filter(p=>p.brandId===config.brandId).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
     <label className="text-sm">Aspect<select className={field} value={config.aspect} onChange={e=>patch('aspect',e.target.value as Config['aspect'])}>{['9:16','16:9','1:1'].map(a=><option key={a}>{a}</option>)}</select></label>
     <label className="text-sm">Duration (seconds)<input className={field} type="number" min={3} max={30} value={config.durationSec} onChange={e=>patch('durationSec',Number(e.target.value))}/></label>
     <label className="text-sm">Daily task limit<input className={field} type="number" min={1} max={12} value={config.dailyTasks} onChange={e=>patch('dailyTasks',Number(e.target.value))}/></label>
     <label className="text-sm">Daily image limit<input className={field} type="number" min={0} max={6} value={config.dailyImages} onChange={e=>patch('dailyImages',Number(e.target.value))}/></label>
     {config.workflow==='H3_SHORT'&&<label className="text-sm">Reserved corrective renders<select className={field} value={config.maxRegenerations??0} onChange={e=>patch('maxRegenerations',Number(e.target.value) as 0|1)}><option value="0">None</option><option value="1">One confirmed visual correction</option></select></label>}
     {config.workflow==='LTX_SHORT'&&config.ltx&&<>
      <label className="text-sm">Approved audio file UUID<input className={field} value={config.ltx.audioFileId} onChange={e=>patch('ltx',{...config.ltx!,audioFileId:e.target.value})}/></label>
      <label className="text-sm">Audio start (seconds)<input className={field} type="number" min={0} value={config.ltx.audioStartSec} onChange={e=>patch('ltx',{...config.ltx!,audioStartSec:Number(e.target.value)})}/></label>
      <label className="text-sm">Worker LoRA filename<input className={field} value={config.ltx.loraName} onChange={e=>patch('ltx',{...config.ltx!,loraName:e.target.value})}/></label>
      <label className="text-sm">LoRA strength<input className={field} type="number" min={0} max={2} step={0.05} value={config.ltx.loraStrength} onChange={e=>patch('ltx',{...config.ltx!,loraStrength:Number(e.target.value)})}/></label>
     </>}
    </div>
    <label className="block text-sm">Instructions<textarea className={field} rows={4} maxLength={6000} value={config.instructions} onChange={e=>patch('instructions',e.target.value)}/></label>
    <h5 className="text-sm font-medium">Versioned skills</h5>
    {config.skills.map((s,i)=><div className="space-y-1" key={i}><input className={field} placeholder="Skill name" value={s.name} onChange={e=>patch('skills',config.skills.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/><textarea className={field} rows={3} placeholder="Instructions" value={s.instructions} onChange={e=>patch('skills',config.skills.map((x,j)=>j===i?{...x,instructions:e.target.value}:x))}/><Button onClick={()=>patch('skills',config.skills.filter((_,j)=>j!==i))}>Remove skill</Button></div>)}
    <Button disabled={config.skills.length>=5} onClick={()=>patch('skills',[...config.skills,{name:'',instructions:''}])}>Add skill</Button>
    <h5 className="text-sm font-medium">Owner-approved memory</h5>
    {config.memory.map((m,i)=><div className="space-y-1" key={i}><input className={field} placeholder="Memory key" value={m.key} onChange={e=>patch('memory',config.memory.map((x,j)=>j===i?{...x,key:e.target.value}:x))}/><textarea className={field} rows={2} placeholder="Approved observation or rule" value={m.value} onChange={e=>patch('memory',config.memory.map((x,j)=>j===i?{...x,value:e.target.value}:x))}/><Button onClick={()=>patch('memory',config.memory.filter((_,j)=>j!==i))}>Remove memory</Button></div>)}
    <Button disabled={config.memory.length>=10} onClick={()=>patch('memory',[...config.memory,{key:'',value:''}])}>Add memory</Button>
    <label className="block text-sm">Research<select className={field} value={config.research} onChange={e=>setConfig(c=>({...c,research:e.target.value as Config['research'],vidiqCredits:e.target.value==='VIDIQ'?5:0,vidiqWatch:false,acceptHostCreditRisk:false}))}><option value="NONE">Original content</option><option value="VIDIQ">vidIQ outlier search</option></select></label>
    {config.research==='VIDIQ'&&<div className="space-y-2 rounded border border-border p-3">
      <label className="block text-sm">Research query<input className={field} maxLength={500} value={config.researchQuery??''} onChange={e=>patch('researchQuery',e.target.value)}/></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={config.vidiqWatch??false} onChange={e=>setConfig(c=>({...c,vidiqWatch:e.target.checked,vidiqCredits:e.target.checked?15:5}))}/>Analyze one selected short (15 total reserved credits)</label>
      <label className="block text-sm">Daily vidIQ reservation limit<input className={field} type="number" min={5} max={100} value={config.vidiqCredits} onChange={e=>patch('vidiqCredits',Number(e.target.value))}/></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={config.acceptHostCreditRisk??false} onChange={e=>patch('acceptHostCreditRisk',e.target.checked)}/>I approve these host-provider calls and understand that Kemokem cannot prevent external calls or independently verify the provider ledger.</label>
    </div>}
    <p className="text-xs text-muted">All updates create a new immutable revision. Research is never enabled implicitly.</p>
    <div className="flex gap-2"><Button disabled={busy||!config.name||!config.brandId||!config.subscriptionId||!config.instructions} onClick={()=>void save()}>Save revision</Button><Button onClick={()=>setOpen(false)}>Close</Button></div>
   </div>}
   {data.agents.map(a=>{
    const usage=data.usage.find(u=>u.agentId===a.id);
    return <div key={a.id} className="space-y-2 rounded border border-border p-3">
     <div className="flex flex-wrap items-center gap-2"><strong>{a.name}</strong><Badge>{a.enabled?'Enabled':'Disabled'}</Badge><Badge>Revision {a.revision}</Badge></div>
     <p className="text-xs text-muted">{data.brands.find(b=>b.id===a.config.brandId)?.name} · {a.config.workflow} · {a.config.schedule.kind==='DAILY'?a.config.schedule.time+' daily':'Manual'}</p>
     {a.lastError&&<p className="text-xs text-bad">Schedule: {a.lastError}</p>}
     <p className="text-xs">Today: {usage?.tasks??0}/{a.config.dailyTasks} task slots · {usage?.images??0}/{a.config.dailyImages} image slots · {usage?.vidiqReserved??0}/{a.config.vidiqCredits} vidIQ reserved credits</p>
     <div className="flex flex-wrap gap-2"><Button disabled={busy||a.enabled} onClick={()=>{setEditId(a.id);setConfig(structuredClone(a.config));setOpen(true);}}>Edit</Button><Button disabled={busy||!data.exclusive} onClick={()=>void perform('/agents/'+a.id+'/run')}>Run now</Button><Button disabled={busy||(!a.enabled&&!data.exclusive)} onClick={()=>void perform('/agents/'+a.id+'/enable',{enabled:!a.enabled})}>{a.enabled?'Disable schedule':'Enable schedule'}</Button></div>
     {data.runs.filter(r=>r.agentId===a.id).map(r=><details className="rounded border border-border p-2 text-xs" key={r.id}>
      <summary className="cursor-pointer">{r.slot} · revision {r.revision} · {r.state} · stage {r.stage+1}</summary>
      <p>{r.detail??'Queued'}</p>
      <details className="my-2"><summary>Execution history</summary>{data.events.filter(e=>e.runId===r.id).map(e=><p key={e.id} className="mt-1">{new Date(e.createdAt).toLocaleString()} · {e.state} · {e.detail}</p>)}</details>
      {r.projectId&&<p>Project: {r.projectId}</p>}{r.jobId&&<p>Render: {r.jobId}</p>}{r.fileId&&<p>Media: {r.fileId}</p>}
      {data.tasks.filter(t=>t.runId===r.id).map(t=><details key={t.id} className="mt-1 border-t border-border pt-1"><summary>{t.stageKey} · {t.state}</summary><p>{t.progress??t.errorCode??''}</p>{t.result!=null&&<pre className="break-all whitespace-pre-wrap">{JSON.stringify(t.result,null,2)}</pre>}</details>)}
      <div className="mt-2 flex gap-2">{r.state==='ACTIVE'&&<Button disabled={busy} onClick={()=>void perform('/runs/'+r.id+'/control',{action:'pause'})}>Pause</Button>}{['PAUSED','BLOCKED'].includes(r.state)&&<Button disabled={busy} onClick={()=>void perform('/runs/'+r.id+'/control',{action:'resume'})}>Resume</Button>}{['ACTIVE','PAUSED','BLOCKED','FAILED'].includes(r.state)&&<Button disabled={busy} onClick={()=>void perform('/runs/'+r.id+'/control',{action:'stop'})}>Stop</Button>}</div>
     </details>)}
    </div>
   })}
  </>}
 </section>;
}
