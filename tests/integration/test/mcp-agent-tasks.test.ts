import { createHash, createHmac, randomUUID } from 'node:crypto';
import { brands, sql } from '@creatoros/db';
import { AGENT_EXECUTE, AGENT_SUBSCRIBE, dispatchMcpAgentTasks } from '@creatoros/services';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { freshDb, makeApi, makeOrg } from '../src/helpers';

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
const queue=(requestId=randomUUID(),creator=brandId)=>api.call('POST',admin+'/agent-tasks',{cookie,body:{
  subscriptionId,requestId,input:{taskType:'SCRIPT_GENERATION',brandId:creator,projectId:null,instructions:'Write a short original script.'},
}});
const bound=(requestId:string,extra:object={})=>({principal,requestId,claimToken,...extra});
const script={taskType:'SCRIPT_GENERATION',title:'A title',script:'An original script.',limitations:[]};
const dispatch=()=>dispatchMcpAgentTasks(fresh.handle.db,api.config.env.encryptionKey);
const history=async(id:string)=>(await api.call('GET',admin+'/agent-tasks',{cookie})).body.data.tasks.find((t:{id:string})=>t.id===id);
it('requires explicit scopes and verifies the production callback separately from diagnostics',async()=>{
  await settings([]);
  expect((await subscribe()).status).toBe(403);
  await settings([AGENT_SUBSCRIBE,AGENT_EXECUTE]);
  expect((await sendSite('subscribe',{principal,url,secret},randomUUID(),'5'.repeat(64))).status).toBe(403);
  callbacks.verify.mockRejectedValueOnce(new Error('unsafe_callback_address'));
  expect((await subscribe()).status).toBe(400);
  callbacks.verify.mockResolvedValue(undefined);
  const result=await subscribe();expect(result.status).toBe(200);subscriptionId=result.body.data.id;
  expect((await subscribe()).body.data.id).toBe(subscriptionId);
});
it('uses stable event IDs, single claims, typed completion, and no completion on webhook delivery',async()=>{
  const requestId=randomUUID();
  const added=await queue(requestId);expect(added.status).toBe(200);
  expect((await queue(requestId)).body.data).toEqual(added.body.data);
  expect((await sendSite('claim',bound(requestId))).body.data.claimed).toBe(false);
  callbacks.send.mockClear();callbacks.send.mockResolvedValueOnce({status:503,body:''}).mockResolvedValueOnce({status:202,body:''});
  await dispatch();
  await fresh.handle.db.execute(sql`update agent_tasks set next_attempt_at=now() where id=${requestId}`);
  await dispatch();
  expect(callbacks.send.mock.calls.map(c=>c[3])).toEqual([requestId,requestId]);
  expect(callbacks.send.mock.calls[1]![4]).toMatchObject({name:'kemokem.task.requested',eventId:requestId,data:{requestId,taskType:'SCRIPT_GENERATION',schemaVersion:1}});
  expect(await history(requestId)).toMatchObject({state:'DELIVERED',completedAt:null,attempts:2});
  expect((await sendSite('claim',bound(requestId,{principal:'wrong-principal'}))).status).toBe(404);
  const claimed=await Promise.all([sendSite('claim',bound(requestId)),sendSite('claim',bound(requestId,{claimToken:'b'.repeat(64)}))]);
  expect(claimed.filter(r=>r.body.data?.claimed===true)).toHaveLength(1);
  const winner=claimed[0]!.body.data.claimed?claimToken:'b'.repeat(64);
  const winnerBody={principal,requestId,claimToken:winner};
  expect((await sendSite('claim',winnerBody)).body.data.claimed).toBe(true);
  const info=await sendSite('get',winnerBody);expect(info.body.data.input.brandId).toBe(brandId);
  expect((await sendSite('complete',{...winnerBody,result:{taskType:'IMAGE_GENERATION',uploadRequestId:randomUUID(),fileId:randomUUID(),evidence:'Fake'}})).status).toBe(400);
  const done=await sendSite('complete',{...winnerBody,result:script});expect(done.status).toBe(200);
  expect((await sendSite('complete',{...winnerBody,result:script})).body.data).toEqual(done.body.data);
  expect((await sendSite('complete',{...winnerBody,result:{...script,script:'changed'}})).status).toBe(409);
  expect(await history(requestId)).toMatchObject({state:'COMPLETED',result:script});
});
it('rejects wrong-organization creators, late completion and expired claims without blind retry',async()=>{
  const other=await makeOrg(fresh.handle);
  const [brand]=await fresh.handle.db.insert(brands).values({orgId:other.orgId,name:'Other creator'}).returning({id:brands.id});
  expect((await queue(randomUUID(),brand!.id)).status).toBe(404);
  callbacks.send.mockResolvedValue({status:202,body:''});
  const requestId=randomUUID();expect((await queue(requestId)).status).toBe(200);
  await dispatch();expect((await sendSite('claim',bound(requestId))).body.data.claimed).toBe(true);
  expect((await api.call('POST',admin+'/agent-tasks/'+requestId+'/cancel',{cookie})).status).toBe(200);
  expect((await sendSite('complete',bound(requestId,{result:script}))).status).toBe(409);
  expect(await history(requestId)).toMatchObject({state:'CANCELLED'});
  const expired=randomUUID();expect((await queue(expired)).status).toBe(200);
  await dispatch();expect((await sendSite('claim',bound(expired))).body.data.claimed).toBe(true);
  await fresh.handle.db.execute(sql`update agent_tasks set lease_until=now()-interval '1 second' where id=${expired}`);
  callbacks.send.mockClear();await dispatch();expect(callbacks.send).not.toHaveBeenCalled();
  expect(await history(expired)).toMatchObject({state:'TIMED_OUT'});
  expect((await sendSite('complete',bound(expired,{result:script}))).status).toBe(409);
  await settings([AGENT_SUBSCRIBE]);
  expect((await sendSite('status',{principal,requestId:expired})).status).toBe(403);
});

it('requires the exact active claim for a reserved binary upload and rejects cancellation', async () => {
  await settings([AGENT_SUBSCRIBE, AGENT_EXECUTE, 'media.upload.image']);
  const renewed = await subscribe();
  expect(renewed.status).toBe(200);
  subscriptionId = renewed.body.data.id;
  const requestId = randomUUID();
  const uploadId = randomUUID();
  expect((await queue(requestId)).status).toBe(200);
  callbacks.send.mockResolvedValue({ status: 202, body: '' });
  await dispatch();
  expect((await sendSite('claim', bound(requestId))).body.data.claimed).toBe(true);

  // Seed a reserved upload transport fixture. Admission and scanner writes are tested separately.
  const payload = Buffer.from('fixture');
  const checksum = createHash('sha256').update(payload).digest('hex');
  const input = {
    rootId: randomUUID(), brandId, fileName: 'fixture.png', mime: 'image/png',
    size: payload.length, sha256: checksum,
  };
  const result = { uploadState: 'OPEN', expiresAt: new Date(Date.now() + 60000).toISOString() };
  await fresh.handle.db.execute(sql`update agent_tasks set upload_request_id=${uploadId} where id=${requestId}`);
  await fresh.handle.db.execute(sql`
    insert into ai_gateway_requests(id,org_id,mode,credential_hash,operation,scope,input,status,result)
    select ${uploadId},org_id,'hosted',credential_hash,'media.prepareImageUpload','media.upload.image',
      ${JSON.stringify(input)}::jsonb,'COMPLETED',${JSON.stringify(result)}::jsonb
    from agent_tasks where id=${requestId}
  `);
  const upload = (claim?: string) => api.call('PUT', '/api/v1/ai-gateway/uploads/' + uploadId, {
    raw: payload.subarray(0, 1),
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream',
      'content-length': '1', ...(claim ? { 'x-kemokem-task-claim': claim } : {}) },
  });
  expect((await upload()).status).toBe(403);
  expect((await upload('b'.repeat(64))).status).toBe(403);
  // An exact claim reaches content-length validation. The fixture never writes to the scanner.
  const acceptedClaim = await upload(claimToken);
  expect(acceptedClaim.status).toBe(400);
  expect(acceptedClaim.body.error.message).toContain('exact Content-Length');
  expect((await api.call('POST', admin+'/agent-tasks/'+requestId+'/cancel', { cookie })).status).toBe(200);
  expect((await upload(claimToken)).status).toBe(403);
});
