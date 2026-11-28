'use client';

import { useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { post, useApi } from '@/lib/api';

const path = '/integrations/ai-gateway/agent-tasks';
type TaskType = 'CONTENT_STRATEGY' | 'SCRIPT_GENERATION' | 'IMAGE_GENERATION';
type Task = {id:string;taskType:TaskType|'RESEARCH'|'PRODUCTION_PLANNING'|'VIDEO_REVIEW'|'SEO_GENERATION';state:string;brandId:string;projectId:string|null;createdAt:string;
  attempts:number;progress:string|null;errorCode:string|null;result:unknown;completedAt:string|null};
type Board = {
  subscriptions: {id:string;expiresAt:string;revokedAt:string|null}[];
  brands:{id:string;name:string;referenceFileIds:string[]}[];
  projects:{id:string;title:string;brandId:string}[];
  tasks:Task[];
};
const activeStates = new Set(['QUEUED','DISPATCHED','DELIVERED','CLAIMED','RUNNING']);
const labels:Record<TaskType,string>={CONTENT_STRATEGY:'Content strategy',SCRIPT_GENERATION:'Script generation',IMAGE_GENERATION:'Character or scene image'};
export function AgentTasksCard() {
  const {data,error,mutate}=useApi<Board>(path,{refreshInterval:5000});
  const [type,setType]=useState<TaskType>('IMAGE_GENERATION');
  const [brand,setBrand]=useState('');
  const [project,setProject]=useState('');
  const [selected,setSelected]=useState('');
  const [prompt,setPrompt]=useState('');
  const [aspect,setAspect]=useState('9:16');
  const [extras,setExtras]=useState('');
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const subs=(data?.subscriptions??[]).filter(s=>!s.revokedAt&&Date.parse(s.expiresAt)>Date.now());
  const subscriptionId=subs.find(s=>s.id===selected)?.id??subs[0]?.id??'';
  const creator=data?.brands.find(b=>b.id===brand);
  const projects=data?.projects.filter(p=>p.brandId===brand)??[];
  const image=type==='IMAGE_GENERATION';
  const refs=[...(creator?.referenceFileIds??[]),...extras.split(/[\s,]+/).map(x=>x.trim()).filter(Boolean)];
  const canQueue=Boolean(subscriptionId&&creator&&prompt.trim()&&(!image||project)&&!busy);
  const queue=async()=>{
    if(!canQueue)return;
    setBusy(true);setFailure('');
    try {
      const input={taskType:type,brandId:brand,projectId:project||null,instructions:prompt.trim(),
        ...(image?{aspect,referenceFileIds:[...new Set(refs)]}:{})};
      await post(path,{subscriptionId,requestId:crypto.randomUUID(),input});
      await mutate();
    }catch(e){setFailure(e instanceof Error?e.message:'Task request failed.');}
    finally{setBusy(false);}
  };
  const cancel=async(id:string)=>{
    if(!window.confirm('Cancel this task? A remote ChatGPT execution already in progress may continue, but new task-bound uploads and completion will be rejected.'))return;
    setBusy(true);setFailure('');
    try{await post(path+'/'+id+'/cancel');await mutate();}
    catch(e){setFailure(e instanceof Error?e.message:'Cancellation failed.');}
    finally{setBusy(false);}
  };
  return (
    <section className="mt-4 space-y-3 border-t border-border pt-3" aria-labelledby="agent-tasks-title">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="agent-tasks-title" className="font-semibold">ChatGPT agent tasks</h3>
        <Badge tone={subs.length?'ok':'warn'}>{subs.length} active production subscriptions</Badge>
      </div>
      <p className="text-sm text-muted">Owner-authorized individual creative tasks. Scheduled end-to-end production is not enabled by this task queue. Image generation requires a verified Work capability and a dedicated upload root.</p>
      {error&&<p role="alert" className="text-sm text-bad">{error.message}</p>}
      {data&&<>
        {!subs.length&&<p className="text-sm text-muted">Enable Hosted agents.subscribe and agents.execute, refresh the existing connector, and subscribe a Work conversation to kemokem.task.requested.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-sm">Production subscription
            <select className="block w-full rounded border border-border bg-transparent p-2" value={subscriptionId} onChange={e=>setSelected(e.target.value)}>
              {!subs.length&&<option value="">No subscription</option>}
              {subs.map(s=><option key={s.id} value={s.id}>{s.id.slice(0,12)} · {new Date(s.expiresAt).toLocaleString()}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">Task
            <select className="block w-full rounded border border-border bg-transparent p-2" value={type} onChange={e=>setType(e.target.value as TaskType)}>
              {(Object.keys(labels) as TaskType[]).map(t=><option key={t} value={t}>{labels[t]}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">Creator
            <select className="block w-full rounded border border-border bg-transparent p-2" value={brand} onChange={e=>{setBrand(e.target.value);setProject('');setExtras('');}}>
              <option value="">Select creator</option>
              {data.brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">Project {image?'(required)':'(optional)'}
            <select className="block w-full rounded border border-border bg-transparent p-2" value={project} onChange={e=>setProject(e.target.value)}>
              <option value="">Select project</option>
              {projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          {image&&<>
            <label className="space-y-1 text-sm">Aspect ratio
              <select className="block w-full rounded border border-border bg-transparent p-2" value={aspect} onChange={e=>setAspect(e.target.value)}>
                {['9:16','16:9','1:1','4:5','3:2','2:3'].map(a=><option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">Additional approved reference file IDs
              <input className="block w-full rounded border border-border bg-transparent p-2" value={extras} onChange={e=>setExtras(e.target.value)} placeholder="Optional UUIDs, separated by commas"/>
            </label>
            <p className="text-xs text-muted sm:col-span-2">{creator?.referenceFileIds.length??0} canonical reference(s) will be sent first, in their saved order.</p>
          </>}
        </div>
        <label className="block space-y-1 text-sm">Instructions
          <textarea className="block w-full rounded border border-border bg-transparent p-2" rows={5} maxLength={20000} value={prompt} onChange={e=>setPrompt(e.target.value)}/>
        </label>
        <Button disabled={!canQueue} onClick={()=>void queue()}>{busy?'Working…':'Queue task'}</Button>
        {failure&&<p role="alert" className="text-sm text-bad">{failure}</p>}
        <details open>
          <summary className="cursor-pointer text-sm">Recent agent tasks</summary>
          {data.tasks.length===0&&<p className="text-sm text-muted">No production tasks.</p>}
          {data.tasks.map(t=><div className="mt-2 space-y-1 rounded border border-border p-2 text-xs" key={t.id}>
            <div className="flex flex-wrap items-center gap-2"><strong>{(t.taskType in labels?labels[t.taskType as TaskType]:t.taskType.replaceAll('_',' '))}</strong><Badge tone={t.state==='COMPLETED'?'ok':activeStates.has(t.state)?'warn':undefined}>{t.state}</Badge></div>
            <p className="break-all">{t.id} · {new Date(t.createdAt).toLocaleString()} · {t.attempts} dispatch attempts</p>
            {t.progress&&<p className="whitespace-pre-wrap">{t.progress}</p>}
            {t.errorCode&&<p className="text-bad">{t.errorCode}</p>}
            {t.result!=null&&<details><summary>Validated result</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(t.result,null,2)}</pre></details>}
            {activeStates.has(t.state)&&<Button disabled={busy} onClick={()=>void cancel(t.id)}>Cancel task</Button>}
          </div>)}
        </details>
      </>}
    </section>
  );
}
