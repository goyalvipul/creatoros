import { createHmac, randomUUID } from 'node:crypto';
import { brands, sql } from '@creatoros/db';
import { AGENT_EXECUTE, AGENT_SUBSCRIBE, dispatchMcpAgentTasks, runDueAgentStudio } from '@creatoros/services';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { freshDb, makeApi } from '../src/helpers';

const callbacks = vi.hoisted(()=>({verify:vi.fn(),send:vi.fn()}));
vi.mock('../../../packages/services/src/mcp-event-webhook',async importOriginal=>({
  ...(await importOriginal<typeof import('../../../packages/services/src/mcp-event-webhook')>()),
  verifyMcpCallback:callbacks.verify,sendMcpWebhook:callbacks.send,
}));
const gateway='/api/v1/ai-gateway/agent-events/';
const admin='/api/v1/integrations/ai-gateway';
const siteKey='4'.repeat(64);
const principal='agent-test-owner';
const url='https://receiver.example.com/agents';
const secret='whsec_'+Buffer.alloc(32,42).toString('base64');
const claimToken='a'.repeat(64);
let fresh:Awaited<ReturnType<typeof freshDb>>;
let api:Awaited<ReturnType<typeof makeApi>>;
let cookie:string;
let token:string;
let brandId:string;
let subscriptionId:string;
beforeAll(async()=>{
  fresh=await freshDb();
  api=await makeApi(fresh.handle,fresh.url,{KEMOKEM_MCP_EVENTS_KEY:siteKey});
  const owner=await api.call('POST','/api/v1/setup/bootstrap',{body:{
    email:'agents@test.local',password:'violet harbor lantern quartz',name:'Agent owner',
    orgName:'Agent tasks',timezone:'America/Vancouver',currency:'CAD',
  }});
  expect(owner.status).toBe(201);cookie=owner.cookie!;
  const credential=await api.call('POST',admin+'/credential',{cookie,body:{mode:'hosted',action:'rotate'}});
  token=credential.body.data.token;
  const [org]=(await fresh.handle.db.execute(sql`select org_id from ai_gateway_connections where hosted_hash is not null`)).rows as {org_id:string}[];
  const [brand]=await fresh.handle.db.insert(brands).values({orgId:org!.org_id,name:'Task test creator'}).returning({id:brands.id});
  brandId=brand!.id;
});
afterAll(async()=>{await api?.close();await fresh?.drop();});
function sendSite(action:string,body:object,nonce=randomUUID(),key=siteKey){
  const time=String(Math.floor(Date.now()/1000));
  const sig=createHmac('sha256',key).update([time,nonce,'agent.'+action,JSON.stringify(body)].join('.')).digest('hex');
  return api.call('POST',gateway+action,{body,headers:{
    authorization:'Bearer '+token,'x-kemokem-event-time':time,'x-kemokem-event-nonce':nonce,'x-kemokem-event-signature':sig,
  }});
}
const settings=(scopes:string[])=>api.call('POST',admin+'/settings',{cookie,body:{enabled:true,mode:'hosted',hostedScopes:scopes}});
const subscribe=()=>sendSite('subscribe',{principal,url,secret});
const bound=(requestId:string,extra:object={})=>({principal,requestId,claimToken,...extra});
const script={taskType:'SCRIPT_GENERATION',title:'A title',script:'An original script.',limitations:[]};
const dispatch=()=>dispatchMcpAgentTasks(fresh.handle.db,api.config.env.encryptionKey);

it('runs the persisted two-stage workflow, deduplicates ticks and prevents broad MCP calls in exclusive mode',async()=>{
 await settings([AGENT_SUBSCRIBE,AGENT_EXECUTE,'projects.read']);
 callbacks.verify.mockResolvedValue(undefined);
 callbacks.send.mockResolvedValue({status:202,body:''});
 const sub=await subscribe();expect(sub.status).toBe(200);subscriptionId=sub.body.data.id;
 const base=admin+'/agent-studio';
 const post=(path:string,body:object={})=>api.call('POST',base+path,{cookie,body});
 const get=async()=>(await api.call('GET',base,{cookie})).body.data;
 const config={name:'Native script agent',brandId,subscriptionId,workflow:'SCRIPT',schedule:{kind:'DAILY',time:'00:00'},
  instructions:'Write original scripts.',skills:[{name:'Safety',instructions:'Only original content'}],memory:[{key:'Style',value:'Natural'}],
  projectId:null,workerId:null,aspect:'9:16',durationSec:12,research:'NONE',dailyTasks:6,dailyImages:0,vidiqCredits:0};
 const created=await post('/agents',config);expect(created.status).toBe(200);const agent=created.body.data.id;
 expect((await post('/agents/'+agent+'/run')).status).toBe(409);
 expect((await post('/exclusive',{enabled:true})).status).toBe(200);
 expect((await post('/agents/'+agent+'/enable',{enabled:true})).status).toBe(409);
 const tools=await api.call('GET','/api/v1/ai-gateway/tools',{headers:{authorization:'Bearer '+token}});
 expect(tools.body.data).toEqual([]);
 const started=await post('/agents/'+agent+'/run');expect(started.status).toBe(200);const run=started.body.data.id;
 expect((await post('/agents/'+agent+'/run')).body.data.id).toBe(run);
 const tick=()=>runDueAgentStudio(fresh.handle.db,api.config.env);
 await tick();await tick();
 let board=await get();expect(board.tasks.filter((t:{runId:string})=>t.runId===run)).toHaveLength(1);
 const first=board.tasks.find((t:{runId:string;stageKey:string})=>t.runId===run&&t.stageKey==='CONTENT_STRATEGY').id;
 await dispatch();expect((await sendSite('claim',bound(first))).body.data.claimed).toBe(true);
 expect((await sendSite('complete',bound(first,{result:{taskType:'CONTENT_STRATEGY',concepts:[{title:'Original',rationale:'Reason',brief:'Brief'}],limitations:[]}}))).status).toBe(200);
 await tick();await tick();await tick();
 board=await get();const second=board.tasks.find((t:{runId:string;stageKey:string})=>t.runId===run&&t.stageKey==='SCRIPT_GENERATION').id;
 await dispatch();expect((await sendSite('claim',bound(second))).body.data.claimed).toBe(true);
 expect((await sendSite('complete',bound(second,{result:script}))).status).toBe(200);
 await tick();await tick();
 board=await get();expect(board.runs.find((r:{id:string})=>r.id===run).state).toBe('COMPLETED');
 expect(board.events.some((e:{runId:string;state:string})=>e.runId===run&&e.state==='COMPLETED')).toBe(true);
 expect((await post('/agents/'+agent+'/enable',{enabled:true})).status).toBe(200);
 await tick();expect((await get()).runs.filter((r:{agentId:string})=>r.agentId===agent)).toHaveLength(1);
 expect((await post('/agents/'+agent,{...config,instructions:'New revision'})).status).toBe(409);
 expect((await post('/agents/'+agent+'/enable',{enabled:false})).status).toBe(200);
 const edited=await post('/agents/'+agent,{...config,instructions:'New revision'});
 expect(edited.body.data.revision).toBe(2);
 expect((await get()).runs.find((r:{id:string})=>r.id===run).revision).toBe(1);
 expect((await post('/exclusive',{enabled:false})).status).toBe(200);
});
