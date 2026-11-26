'use client';

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ActionButton, Badge, Card } from '@/components/ui';
import { useMe } from '@/components/shell';
import { post, refresh, useApi } from '@/lib/api';

const path='/integrations/ai-gateway/requests';
type RequestRow={id:string;mode:string;operation:string;input:unknown;status:string;expiresAt:string;result:unknown};
const labels:Record<string,string>={
  'projects.create':'Create project','generation.h3':'Generate MiniMax H3 video',
  'h3.save':'Save MiniMax editor','media.uploadImage':'Upload image','media.uploadAudio':'Upload audio',
  'publishing.draft':'Save publishing draft','publishing.schedule':'Schedule social post','replies.send':'Send reply',
};

export function AiGatewayApprovals(){
  const me=useMe();
  const owner=me.data?.user?.role==='OWNER';
  const requests=useApi<RequestRow[]>(owner?path:null,{refreshInterval:10000,revalidateOnFocus:true,keepPreviousData:false});
  const [focus,setFocus]=useState('');
  const [busy,setBusy]=useState<string|null>(null);
  const lock=useRef(false);
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{
    const target=new URLSearchParams(window.location.search).get('approval')??'';
    setFocus(target);
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return ()=>window.clearInterval(timer);
  },[]);
  const pending=(requests.data??[]).filter(r=>r.status==='PENDING'&&Date.parse(r.expiresAt)>now);
  const history=(requests.data??[]).filter(r=>!pending.some(p=>p.id===r.id));
  useEffect(()=>{
    if(focus&&requests.data)document.getElementById('gateway-request-'+focus)?.scrollIntoView({block:'center'});
  },[focus,requests.data]);
  if(!owner)return null;
  async function review(id:string,decision:'approve'|'reject'){
    if(lock.current)return;
    lock.current=true;setBusy(id);
    try{await post(path+'/'+id+'/review',{decision});}
    finally{lock.current=false;setBusy(null);await requests.mutate();void refresh('/notifications');}
  }
  return <section id="gateway-approvals" className="mb-4 scroll-mt-20" aria-label="ChatGPT approvals">
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="size-5 text-accent" aria-hidden/>
        <h2 className="flex-1 font-semibold">ChatGPT approvals</h2>
        {pending.length>0&&<Badge tone="warn">{pending.length} pending</Badge>}
        <ActionButton size="sm" onAction={async()=>{await requests.mutate();}}>Refresh</ActionButton>
      </div>
      <p className="mt-1 text-xs text-muted">Review requests outside your trusted production policy. Approval expires after 30 minutes. Notifications open this section.</p>
      {requests.error&&<p role="alert" className="mt-2 text-sm text-bad">{requests.error.message}</p>}
      {!requests.data&&!requests.error&&<p className="mt-2 text-sm text-muted">Checking requests…</p>}
      {requests.data&&pending.length===0&&<p className="mt-2 text-sm text-muted">No pending approvals.</p>}
      {focus&&requests.data&&!requests.data.some(r=>r.id===focus)&&<p className="mt-2 text-sm text-muted">This request is no longer in the recent list. It may have expired or been reviewed.</p>}
      <div className="mt-3 space-y-2" aria-live="polite">
        {pending.map(r=><article key={r.id} id={'gateway-request-'+r.id} className={'rounded-lg border border-border p-3 scroll-mt-20'+(focus===r.id?' ring-2 ring-accent':'')}>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="flex-1 text-sm">{labels[r.operation]??r.operation}</strong>
            <Badge tone="warn">{Math.max(0,Math.ceil((Date.parse(r.expiresAt)-now)/60000))} min left</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">{r.mode} MCP · {r.operation}</p>
          <details className="mt-2" open={focus===r.id||undefined}>
            <summary className="cursor-pointer text-sm">Review exact request</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(r.input,null,2)}</pre>
          </details>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton variant="primary" disabled={busy!==null} confirm="Execute this exact requested operation?" onAction={()=>review(r.id,'approve')}>Approve and execute</ActionButton>
            <ActionButton variant="danger" disabled={busy!==null} confirm="Reject this request?" onAction={()=>review(r.id,'reject')}>Reject</ActionButton>
          </div>
        </article>)}
      </div>
      {history.length>0&&<details className="mt-3">
        <summary className="cursor-pointer text-sm text-muted">Recent request history ({history.length})</summary>
        {history.map(r=><details key={r.id} id={'gateway-request-'+r.id} className="mt-2 rounded border border-border p-2" open={focus===r.id||undefined}>
          <summary className="cursor-pointer text-sm">{labels[r.operation]??r.operation} · {r.status==='PENDING'?'EXPIRED':r.status}</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(r.input,null,2)}</pre>
        </details>)}
      </details>}
    </Card>
  </section>;
}
