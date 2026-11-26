import { sql } from '@creatoros/db';
import { listGpuWorkers } from './comfy';
import { listWindowsTasks, requestWindowsTaskRestart } from './windows-tasks';
import { badRequest, conflict, notFound, type Ctx } from './types';

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;
const FRESH_MS = 180_000;
type QueueState = 'available' | 'busy' | 'unreachable' | 'unknown' | 'disabled';
type Worker = Awaited<ReturnType<typeof listGpuWorkers>>[number];
type Device = { id: string; name: string; hostname: string | null; os: string | null; state: string; seenAt: Date | null; tailscale: string | null; urls: string[]; cpu: unknown; scanning: unknown };
type Job = { id:string; workerId:string|null; projectId:string|null; title:string|null; provider:string; status:string; startedAt:Date|null; createdAt:Date; phase:unknown; detail:unknown; value:unknown; max:unknown };
function textValue(value:unknown,max=160) { return typeof value==='string'?value.slice(0,max):null; }
function numberValue(value:unknown) { return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null; }
export function memoryReading(total:unknown,free:unknown) {
  const t=numberValue(total),f=numberValue(free);
  return t!==null&&t>0&&f!==null&&f<=t?{usedBytes:t-f,totalBytes:t}:null;
}
function host(value:string|null|undefined) {
  if(!value)return null;
  try{return new URL(value.includes('://')?value:'http://'+value).hostname.toLowerCase().replace(/\.$/,'');}catch{return null;}
}
/** A destructive action must not be routed via a guessed label or VRAM capacity. */
export function matchMachine(workerUrl:string, devices:Device[]) {
  const h=host(workerUrl);
  if(!h||['localhost','127.0.0.1','[::1]','0.0.0.0'].includes(h))return null;
  const matches=devices.filter(d=>[d.tailscale,d.hostname,...d.urls].some(v=>host(v)===h));
  return matches.length===1?matches[0]!:null;
}
function online(d:Device,now:Date) {
  const age=d.seenAt?now.getTime()-new Date(d.seenAt).getTime():Infinity;
  return d.state==='ONLINE'&&age>=0&&age<=FRESH_MS;
}
async function readJson(base:string,path:string) {
  try {
    const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(4000),redirect:'error',headers:{accept:'application/json'}});
    if(!response.ok)return {status:'unreachable' as const,body:null};
    // The queue may contain prompts; keep them server-side. Never return workflow contents.
    const value:unknown=await response.json();
    return value&&typeof value==='object'&&!Array.isArray(value)?{status:'ok' as const,body:value as Record<string,unknown>}:{status:'unknown' as const,body:null};
  } catch { return {status:'unreachable' as const,body:null}; }
}
export function queueCounts(body:Record<string,unknown>|null) {
  if(!body||!Array.isArray(body.queue_running)||!Array.isArray(body.queue_pending))return null;
  return {running:body.queue_running.length,pending:body.queue_pending.length};
}
async function inspectWorker(w:Worker,jobs:Job[]) {
  if(!w.enabled)return {state:'disabled' as QueueState,counts:null,vram:null,ram:null,checkedAt:new Date().toISOString()};
  const [queue,stats]=await Promise.all([readJson(w.baseUrl,'/queue'),readJson(w.baseUrl,'/system_stats')]);
  const counts=queueCounts(queue.body);
  const state:QueueState=jobs.length||counts&&(counts.running+counts.pending)>0?'busy':counts?'available':queue.status==='unreachable'?'unreachable':'unknown';
  const devices=stats.body?.devices;
  const system=stats.body?.system as Record<string,unknown>|undefined;
  const gpu=Array.isArray(devices)?devices.filter(x=>x&&typeof x==='object').sort((a,b)=>(numberValue(b.vram_total)??0)-(numberValue(a.vram_total)??0))[0]:null;
  return {state,counts,vram:memoryReading(gpu?.vram_total,gpu?.vram_free),ram:memoryReading(system?.ram_total,system?.ram_free),checkedAt:new Date().toISOString()};
}
async function devicesFor(ctx:Ctx) {
  return rows<Device>(await ctx.db.execute(sql`
    select id,display_name as name,hostname,os,state,last_seen_at as "seenAt",tailscale_hint as tailscale,listen_urls as urls,load->'cpuPct' as cpu,load->'scanning' as scanning
    from devices where org_id=${ctx.orgId} and state<>'REVOKED' order by display_name
  `));
}
async function activeJobs(ctx:Ctx) {
  return rows<Job>(await ctx.db.execute(sql`
    select j.id,j.settings->>'workerId' as "workerId",j.project_id as "projectId",p.title,j.provider,j.status,j.started_at as "startedAt",j.created_at as "createdAt",
      j.settings->'progress'->'phase' as phase,j.settings->'progress'->'detail' as detail,j.settings->'progress'->'value' as value,j.settings->'progress'->'max' as max
    from generation_jobs j left join creative_projects p on p.id=j.project_id and p.org_id=j.org_id
    where j.org_id=${ctx.orgId} and j.status in ('QUEUED','RUNNING')
    order by case when j.status='RUNNING' then 0 else 1 end,j.created_at
  `));
}
function cleanJob(j:Job) {
  const value=numberValue(j.value),max=numberValue(j.max);
  return {id:j.id,projectId:j.projectId,title:j.title,provider:j.provider,status:j.status,startedAt:j.startedAt,createdAt:j.createdAt,
    phase:textValue(j.phase,60),detail:textValue(j.detail,200),progress:value!==null&&max!==null&&max>0&&value<=max?{value,max}:null};
}
export async function machineMonitor(ctx:Ctx) {
  const [workers,devices,jobs,taskList]=await Promise.all([listGpuWorkers(ctx),devicesFor(ctx),activeJobs(ctx),listWindowsTasks(ctx)]);
  const now=ctx.now();
  const assigned=new Set<string>();
  const machines=await Promise.all(workers.map(async w=>{
    const d=matchMachine(w.baseUrl,devices);
    if(d)assigned.add(d.id);
    const workerJobs=jobs.filter(j=>j.workerId===w.id);
    const snapshot=await inspectWorker(w,workerJobs);
    const candidates=d?taskList.tasks.filter(t=>t.deviceId===d.id&&/comfy\s*ui/i.test(t.label+' '+t.taskName)):[];
    const task=candidates.length===1?candidates[0]!:null;
    const restarting=task?.restartStatus==='PENDING'||task?.restartStatus==='RUNNING';
    const canRestart=!!(w.enabled&&d&&online(d,now)&&task&&task.checkedAt&&now.getTime()-new Date(task.checkedAt).getTime()<=FRESH_MS&&!restarting&&!['DISABLED','NOT_FOUND','UNKNOWN'].includes(task.status)&&!workerJobs.length&&snapshot.state==='available'&&jobs.every(j=>!!j.workerId));
    return {id:w.id,label:w.label,role:w.role,expectedVramGb:w.expectedVramGb,...snapshot,
      agent:d?{name:d.name,online:online(d,now),seenAt:d.seenAt,cpuPct:online(d,now)&&numberValue(d.cpu)!==null&&Number(d.cpu)<=100?Number(d.cpu):null}:null,
      jobs:workerJobs.slice(0,3).map(cleanJob),jobCount:workerJobs.length,
      restart:task?{taskId:task.id,label:task.label,deviceName:task.deviceName,status:task.restartStatus,canRestart}:null};
  }));
  return {machines,unassignedJobCount:jobs.filter(j=>!j.workerId||!workers.some(w=>w.id===j.workerId)).length,
    storageAgents:devices.filter(d=>!assigned.has(d.id)).map(d=>({id:d.id,name:d.name,online:online(d,now),seenAt:d.seenAt,scanning:online(d,now)&&d.scanning===true})),
    sampledAt:new Date().toISOString()};
}
/** Dashboard restart: exact unique host match, known idle queue, fresh paired agent,
 * configured ComfyUI task, and a second server-side check. No arbitrary commands. */
export async function restartMonitoredComfy(ctx:Ctx,workerId:string,taskId:string) {
  const monitor=await machineMonitor(ctx);
  const machine=monitor.machines.find(m=>m.id===workerId);
  if(!machine)throw notFound('Machine');
  if(!machine.restart||machine.restart.taskId!==taskId)throw badRequest('Configure a uniquely matched ComfyUI scheduled task in Studio settings.');
  if(!machine.restart.canRestart||monitor.unassignedJobCount)throw conflict('Restart blocked: queue must be empty, agent fresh, and no active or unassigned generation jobs for the target.');
  // Existing agent request is asynchronous. Never report a completed restart from this response.
  return requestWindowsTaskRestart(ctx,taskId);
}
