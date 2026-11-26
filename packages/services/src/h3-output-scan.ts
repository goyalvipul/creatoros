import {sql,type Db} from '@creatoros/db';
const rows=<T>(r:unknown)=>(r as {rows:T[]}).rows;
function host(v:string|null){
  if(!v)return null;
  try{return new URL(v.includes('://')?v:'http://'+v).hostname.toLowerCase().replace(/\.$/,'');}catch{return null;}
}
type Device={id:string;hostname:string|null;tailscale:string|null;urls:string[]};
export function selectOutputRoot(workerUrl:string,devices:Device[],roots:{id:string;deviceId:string;path:string;state:string}[]){
  const h=host(workerUrl);
  if(!h||['localhost','127.0.0.1','[::1]','0.0.0.0'].includes(h))return null;
  const matching=devices.filter(d=>[d.hostname,d.tailscale,...d.urls].some(v=>host(v)===h));
  if(matching.length!==1)return null;
  const candidates=roots.filter(r=>r.deviceId===matching[0]!.id&&r.state==='ACTIVE'&&/(?:^|[\\/])output[\\/]*$/i.test(r.path));
  return candidates.length===1?candidates[0]!:null;
}
/** Existing scanner consumes scan_requested_at. Do not sweep all library roots or
 * claim that a request means the file has been indexed. Retry after the settle window. */
export async function requestH3OutputScan(db:Db){
  const jobs=rows<{id:string;orgId:string;workerUrl:string}>(await db.execute(sql`
    select j.id,j.org_id as "orgId",w.base_url as "workerUrl"
    from generation_jobs j join gpu_workers w on w.org_id=j.org_id and w.id::text=j.settings->>'workerId'
    where j.provider='comfyui-h3' and j.status='SUCCEEDED' and j.finished_at>now()-interval '1 day'
      and exists(select 1 from generation_outputs o where o.job_id=j.id and o.org_id=j.org_id and o.output_role='final' and o.file_instance_id is null)
      and (j.settings->>'outputScanRequestedAt' is null or (j.settings->>'outputScanRequestedAt')::timestamptz<now()-interval '3 minutes')
    order by j.finished_at limit 20`));
  for(const j of jobs){
    await db.transaction(async tx=>{
      const devices=rows<Device>(await tx.execute(sql`select id,hostname,tailscale_hint as tailscale,listen_urls as urls from devices where org_id=${j.orgId} and state<>'REVOKED'`));
      const roots=rows<{id:string;deviceId:string;path:string;state:string}>(await tx.execute(sql`select id,device_id as "deviceId",display_path as path,state from storage_roots where org_id=${j.orgId} and state='ACTIVE'`));
      const root=selectOutputRoot(j.workerUrl,devices,roots);
      if(root)await tx.execute(sql`update storage_roots set scan_requested_at=now(),updated_at=now()
        where id=${root.id} and org_id=${j.orgId} and state='ACTIVE'
          and (scan_requested_at is null or scan_requested_at<now()-interval '3 minutes')`);
      await tx.execute(sql`update generation_jobs set settings=settings||${JSON.stringify({outputScanRequestedAt:new Date().toISOString(),outputScanRootId:root?.id??null,outputScanStatus:root?'SCAN_REQUESTED':'ROOT_NOT_MAPPED'})}::jsonb,updated_at=now()
        where id=${j.id} and org_id=${j.orgId} and status='SUCCEEDED'`);
    });
  }
}
