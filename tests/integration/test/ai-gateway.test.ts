import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, makeApi, type Api } from '../src/helpers';

const gateway='/api/v1/ai-gateway';
const admin='/api/v1/integrations/ai-gateway';
let fresh:Awaited<ReturnType<typeof freshDb>>;
let api:Api;
let cookie:string;
let hosted:string;
let local:string;
const auth=(token:string)=>({authorization:'Bearer '+token});
beforeAll(async()=>{
 fresh=await freshDb();api=await makeApi(fresh.handle,fresh.url);
 const r=await api.call('POST','/api/v1/setup/bootstrap',{body:{email:'gateway@test.local',password:'violet harbor lantern quartz',name:'Gateway owner',orgName:'Gateway test',timezone:'America/Vancouver',currency:'CAD'}});
 expect(r.status).toBe(201);cookie=r.cookie!;
 for(const mode of ['local','hosted'] as const){
  const c=await api.call('POST',admin+'/credential',{cookie,body:{mode,action:'rotate'}});
  expect(c.status).toBe(200);expect(c.headers['cache-control']).toContain('no-store');
  if(mode==='local')local=c.body.data.token;else hosted=c.body.data.token;
 }
});
afterAll(async()=>{await api?.close();await fresh?.drop();});
describe('private AI gateway',()=>{
 it('is disabled by default and never accepts cookie-only tool calls',async()=>{
  expect((await api.call('GET',gateway+'/status',{headers:auth(hosted)})).status).toBe(401);
  expect((await api.call('GET',gateway+'/status',{cookie})).status).toBe(401);
 });
 it('enforces selected mode and independent scopes',async()=>{
  const r=await api.call('POST',admin+'/settings',{cookie,body:{enabled:true,mode:'hosted',localScopes:['media.read'],hostedScopes:['projects.read','projects.write']}});
  expect(r.status).toBe(200);
  expect((await api.call('GET',gateway+'/status',{headers:auth(local)})).status).toBe(401);
  expect((await api.call('GET',gateway+'/videos',{headers:auth(hosted)})).status).toBe(403);
  const tools=await api.call('GET',gateway+'/tools',{headers:auth(hosted)});
  expect(tools.status).toBe(200);expect(tools.body.data.map((x:any)=>x.name)).toContain('projects.create');
  expect(tools.body.data.map((x:any)=>x.name)).not.toContain('generation.h3');
 });
 it('requires an owner approval, rejects modified replay, and runs only once',async()=>{
  const requestId=randomUUID();
  const body={operation:'projects.create',input:{title:'Gateway test project'},requestId};
  const request=()=>api.call('POST',gateway+'/invoke',{body,headers:auth(hosted)});
  const a=await request();expect(a.status).toBe(200);expect(a.body.data.status).toBe('PENDING');
  expect((await request()).body.data.id).toBe(requestId);
  const changed=await api.call('POST',gateway+'/invoke',{body:{...body,input:{title:'Changed'}},headers:auth(hosted)});
  expect(changed.status).toBe(409);
  const review=admin+'/requests/'+requestId+'/review';
  expect((await api.call('POST',review,{body:{decision:'approve'},headers:auth(hosted)})).status).toBe(401);
  expect((await api.call('POST',review,{cookie,body:{decision:'approve'}})).status).toBe(200);
  expect((await api.call('POST',review,{cookie,body:{decision:'approve'}})).status).toBe(409);
  const list=await api.call('GET',gateway+'/projects',{headers:auth(hosted)});
  expect(list.body.data.filter((x:any)=>x.title==='Gateway test project')).toHaveLength(1);
 });
 it('executes creative writes with one explicit scope, preserves replay and keeps external actions pending',async()=>{
  const enable=await api.call('POST',admin+'/settings',{cookie,body:{enabled:true,mode:'hosted',hostedScopes:['projects.read','projects.write','production.execute','schedule.write','replies.send','analysis.request']}});
  expect(enable.status).toBe(200);
  const requestId=randomUUID();
  const body={operation:'projects.create',input:{title:'Creative execution project'},requestId};
  const request=()=>api.call('POST',gateway+'/invoke',{body,headers:auth(hosted)});
  const first=await request();
  expect(first.status).toBe(200);expect(first.body.data.status).toBe('COMPLETED');expect(first.body.data.approvalRequired).toBe(false);
  expect((await request()).body.data.status).toBe('COMPLETED');
  const list=await api.call('GET',gateway+'/projects',{headers:auth(hosted)});
  expect(list.body.data.filter((x:any)=>x.title==='Creative execution project')).toHaveLength(1);
  const changed=await api.call('POST',gateway+'/invoke',{headers:auth(hosted),body:{...body,input:{title:'Changed'}}});expect(changed.status).toBe(409);
  // Valid schema but nonexistent targets: external calls must be held, not executed.
  const schedule=await api.call('POST',gateway+'/invoke',{headers:auth(hosted),body:{operation:'publishing.schedule',requestId:randomUUID(),input:{itemId:randomUUID(),socialAccountId:randomUUID(),title:'Test',caption:'',hashtags:[],plannedLocal:'2099-01-01T12:00',timezone:'America/Vancouver'}}});
  expect(schedule.status).toBe(200);expect(schedule.body.data.status).toBe('PENDING');
  const send=await api.call('POST',gateway+'/invoke',{headers:auth(hosted),body:{operation:'replies.send',requestId:randomUUID(),input:{id:randomUUID(),connectionId:randomUUID(),text:'Test'}}});
  expect(send.status).toBe(200);expect(send.body.data.status).toBe('PENDING');
  await api.call('POST',admin+'/settings',{cookie,body:{enabled:true,mode:'hosted',hostedScopes:['projects.read','production.execute']}});
  expect((await api.call('POST',gateway+'/invoke',{headers:auth(hosted),body:{...body,requestId:randomUUID()}})).status).toBe(403);
  await api.call('POST',admin+'/settings',{cookie,body:{enabled:true,mode:'hosted',hostedScopes:['projects.read','projects.write']}});
 });
 it('blocks approval after mode switch and invalidates rotated credentials',async()=>{
  const requestId=randomUUID();
  const a=await api.call('POST',gateway+'/invoke',{headers:auth(hosted),body:{operation:'projects.create',input:{title:'Never run'},requestId}});expect(a.status).toBe(200);
  await api.call('POST',admin+'/settings',{cookie,body:{enabled:true,mode:'local'}});
  expect((await api.call('GET',gateway+'/status',{headers:auth(hosted)})).status).toBe(401);
  expect((await api.call('GET',gateway+'/projects',{headers:auth(local)})).status).toBe(403);
  expect((await api.call('POST',admin+'/requests/'+requestId+'/review',{cookie,body:{decision:'approve'}})).status).toBe(409);
  await api.call('POST',admin+'/credential',{cookie,body:{mode:'local',action:'revoke'}});
  expect((await api.call('GET',gateway+'/status',{headers:auth(local)})).status).toBe(401);
 });
});
