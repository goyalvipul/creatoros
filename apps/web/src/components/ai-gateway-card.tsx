'use client';
import { useState } from 'react';
import { ActionButton, Card, Notice } from '@/components/ui';
import { post, useApi } from '@/lib/api';
const path='/integrations/ai-gateway';
const permissions=[['projects.read','Read production projects'],['media.read','Read video inventory and saved analysis'],['projects.write','Create draft production projects']] as const;
type Settings={enabled:boolean;mode:'local'|'hosted';scopes:string[];localConfigured:boolean;hostedConfigured:boolean;localSeen:string|null;hostedSeen:string|null};
export function AiGatewayCard(){
 const res=useApi<Settings>(path);
 const [token,setToken]=useState<string|null>(null);
 const [tokenMode,setTokenMode]=useState('');
 const s=res.data;
 const save=async(p:Partial<Settings>)=>{if(!s)return;setToken(null);const next={...s,...p};await post(path+'/settings',{enabled:next.enabled,mode:next.mode,scopes:next.scopes});await res.mutate();};
 return <Card className="mb-4"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">ChatGPT · Private AI Gateway</h2><span className="text-sm text-muted">{s?.enabled?'Enabled':'Disabled'}</span></div>
 <p className="mt-1 text-sm text-muted">Connect a private local or hosted MCP adapter. Kemokem remains self-hosted.</p>
 {res.error&&<Notice tone="bad" title="Gateway unavailable">{res.error.message}</Notice>}
 {s&&<div className="mt-3 space-y-3">
 <ActionButton onAction={()=>save({enabled:!s.enabled})}>{s.enabled?'Disable gateway':'Enable gateway'}</ActionButton>
 <div className="flex gap-2">{(['local','hosted'] as const).map(m=><ActionButton key={m} variant={s.mode===m?'primary':undefined} onAction={()=>save({mode:m})}>{m==='local'?'Local MCP':'Hosted MCP'}</ActionButton>)}</div>
 <p className="text-sm text-muted">Only the selected mode is authorized. Switching does not stop existing jobs.</p>
 <code className="block break-all text-xs">/api/v1/ai-gateway/status</code>
 <h3 className="font-medium">Permissions</h3>
 {permissions.map(([key,label])=><div key={key} className="flex items-center justify-between gap-2 text-sm"><span>{label}</span><ActionButton size="sm" onAction={()=>save({scopes:s.scopes.includes(key)?s.scopes.filter(x=>x!==key):[...s.scopes,key]})}>{s.scopes.includes(key)?'Enabled':'Disabled'}</ActionButton></div>)}
 <h3 className="font-medium">Connector credentials</h3>
 {(['local','hosted'] as const).map(m=><div key={m} className="rounded-lg border border-border p-3"><p className="text-sm font-medium">{m==='local'?'Local':'Hosted'} · {(m==='local'?s.localConfigured:s.hostedConfigured)?'Credential issued':'Not configured'}</p><p className="text-xs text-muted">Last authenticated: {(m==='local'?s.localSeen:s.hostedSeen)??'Never'}</p><div className="mt-2 flex gap-2"><ActionButton confirm="Replace the existing credential?" onAction={async()=>{setToken(null);const r=await post(path+'/credential',{mode:m,action:'rotate'});setToken(r.token);setTokenMode(m);await res.mutate();}}>Generate / rotate</ActionButton><ActionButton variant="danger" confirm="Revoke this connector?" onAction={async()=>{setToken(null);await post(path+'/credential',{mode:m,action:'revoke'});await res.mutate();}}>Revoke</ActionButton></div></div>)}
 {token&&<div className="rounded-lg border border-border p-3"><p className="text-sm">Copy the {tokenMode} token now. It is shown only once. Store it in the connector secret store.</p><code className="block break-all text-xs">{token}</code><ActionButton onAction={async()=>{await navigator.clipboard.writeText(token);setToken(null);}}>Copy and hide</ActionButton></div>}
 <Notice tone="info" title="Initial gateway capabilities">Project and media reads, saved analysis and draft project creation. Generation, publishing metadata writes and scheduling are not enabled in this version.</Notice>
 </div>}</Card>;
}
