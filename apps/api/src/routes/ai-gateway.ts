import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql, type Executor } from '@creatoros/db';
import { audit, notify, forbidden, unauthorized, notFound, conflict, badRequest, type Ctx } from '@creatoros/services';
import { makeRouter, type AppDeps } from '../http';
import { operations, permissionGroups, scopes } from './ai-gateway-operations';
import { decodeMedia, MAX_GATEWAY_MEDIA_JSON_BYTES, MAX_GATEWAY_INVOKE_BODY_BYTES } from './ai-gateway-media';
import { productionPolicySchema, productionOperations, authorizeProduction, validatePolicy, creativeOperations, canExecuteCreative, authorizeCreative } from './ai-gateway-production-policy';

const mode = z.enum(['local', 'hosted']);
const scope = z.string().refine(s => (scopes as readonly string[]).includes(s), 'Unknown permission');
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;
type Mode = z.infer<typeof mode>;
type State = { enabled:boolean; mode:Mode; scopes:string[]; local_scopes:string[]; hosted_scopes:string[]; local_configured:boolean; hosted_configured:boolean; local_seen:string|null; hosted_seen:string|null; production_policy:unknown };
type GatewayAuth = { ctx:Ctx; mode:Mode; hash:string; scopes:string[] };
type RequestRow = { id:string; mode:Mode; operation:string; scope:string; input:unknown; status:string; result:unknown; created_at:string; expires_at:string; finished_at:string|null };
function reqFailure(error:unknown):never {
  if(error instanceof z.ZodError) throw badRequest('Approved operation has invalid input.');
  throw badRequest('Operation failed. Review the corresponding Kemokem page before retrying.');
}
const defaults = ['projects.read','media.read'];
async function state(ctx: {orgId:string;db:Executor}) {
  const [r]=rows<State>(await ctx.db.execute(sql`select enabled,mode,case when mode='local' then local_scopes else hosted_scopes end as scopes,local_scopes,hosted_scopes,local_hash is not null as local_configured,hosted_hash is not null as hosted_configured,local_seen,hosted_seen,production_policy from ai_gateway_connections where org_id=${ctx.orgId}`));
  return {...(r??{enabled:false,mode:'hosted',scopes:defaults,local_scopes:defaults,hosted_scopes:defaults,local_configured:false,hosted_configured:false,local_seen:null,hosted_seen:null,production_policy:null}),permissionGroups};
}
function lookup(name:string) {
  if(!Object.hasOwn(operations,name))throw notFound('Gateway operation');
  return operations[name]!;
}
const invokeBody=z.object({operation:z.string().max(80),input:z.unknown().default({}),requestId:z.uuid().optional()}).strict();

export function aiGatewayRoutes(app:FastifyInstance,deps:AppDeps) {
  const route=makeRouter(app,deps);
  route({method:'GET',url:'/integrations/ai-gateway',tag:'AI Gateway',summary:'Gateway settings',role:'OWNER'},async({ctx,reply})=>{reply.header('cache-control','no-store');return state(ctx);});
  route({method:'POST',url:'/integrations/ai-gateway/settings',tag:'AI Gateway',summary:'Update gateway settings',role:'OWNER',body:z.object({enabled:z.boolean(),mode,scopes:z.array(scope).max(scopes.length).optional(),localScopes:z.array(scope).max(scopes.length).optional(),hostedScopes:z.array(scope).max(scopes.length).optional()}).strict()},async({ctx,body})=>{
    await ctx.db.transaction(async tx=>{
      await tx.execute(sql`insert into ai_gateway_connections(org_id) values(${ctx.orgId}) on conflict do nothing`);
      await tx.execute(sql`select org_id from ai_gateway_connections where org_id=${ctx.orgId} for update`);
      const current=await state({...ctx,db:tx});
      const local=body.localScopes??(body.mode==='local'?body.scopes:undefined)??current.local_scopes;
      const hosted=body.hostedScopes??(body.mode==='hosted'?body.scopes:undefined)??current.hosted_scopes;
      await tx.execute(sql`update ai_gateway_connections set enabled=${body.enabled},mode=${body.mode},local_scopes=ARRAY[${sql.join([...new Set(local)].map(s=>sql`${s}`),sql`,`)}]::text[],hosted_scopes=ARRAY[${sql.join([...new Set(hosted)].map(s=>sql`${s}`),sql`,`)}]::text[] where org_id=${ctx.orgId}`);
      await audit({...ctx,db:tx},'ai_gateway.settings',{type:'organization',id:ctx.orgId},undefined,{enabled:body.enabled,mode:body.mode,localScopes:local,hostedScopes:hosted});
    });
    return state(ctx);
  });
  route({method:'GET',url:'/integrations/ai-gateway/production-options',tag:'AI Gateway',summary:'Trusted production choices',role:'OWNER'},async({ctx})=>({
    brands:rows(await ctx.db.execute(sql`select id,name from brands where org_id=${ctx.orgId} and active and deleted_at is null order by name`)),
    roots:rows(await ctx.db.execute(sql`select id,display_path as name from storage_roots where org_id=${ctx.orgId} and state='ACTIVE' and retired_at is null order by display_path`)),
    workers:rows(await ctx.db.execute(sql`select id,label as name from gpu_workers where org_id=${ctx.orgId} and enabled order by label`)),
  }));
  route({method:'POST',url:'/integrations/ai-gateway/production-policy',tag:'AI Gateway',summary:'Set or disable hosted trusted production',role:'OWNER',body:z.object({policy:productionPolicySchema.nullable()}).strict()},async({ctx,body})=>{
    await ctx.db.transaction(async tx=>{
      await tx.execute(sql`insert into ai_gateway_connections(org_id) values(${ctx.orgId}) on conflict do nothing`);
      await tx.execute(sql`select org_id from ai_gateway_connections where org_id=${ctx.orgId} for update`);
      if(body.policy)await validatePolicy({...ctx,db:tx},body.policy);
      await tx.execute(sql`update ai_gateway_connections set production_policy=${JSON.stringify(body.policy)}::jsonb where org_id=${ctx.orgId}`);
      await audit({...ctx,db:tx},'ai_gateway.production_policy',{type:'organization',id:ctx.orgId},undefined,{policy:body.policy});
    });
    return state(ctx);
  });
  route({method:'POST',url:'/integrations/ai-gateway/credential',tag:'AI Gateway',summary:'Rotate or revoke credential',role:'OWNER',body:z.object({mode,action:z.enum(['rotate','revoke'])}).strict()},async({ctx,body,req,reply})=>{
    if(req.headers['idempotency-key'])throw forbidden('Credential operations do not accept idempotency keys.');
    reply.header('cache-control','no-store');
    const token=body.action==='rotate'?'kk_'+body.mode+'_'+randomBytes(32).toString('hex'):null;
    const hash=token?digest(token):null;
    await ctx.db.transaction(async tx=>{
      await tx.execute(sql`insert into ai_gateway_connections(org_id) values(${ctx.orgId}) on conflict do nothing`);
      if(body.mode==='local')await tx.execute(sql`update ai_gateway_connections set local_hash=${hash},local_owner=${token?ctx.userId:null},local_seen=null where org_id=${ctx.orgId}`);
      else await tx.execute(sql`update ai_gateway_connections set hosted_hash=${hash},hosted_owner=${token?ctx.userId:null},hosted_seen=null,production_policy=null where org_id=${ctx.orgId}`);
      await tx.execute(sql`update ai_gateway_requests set status='REJECTED',finished_at=now() where org_id=${ctx.orgId} and mode=${body.mode} and status='PENDING'`);
      await audit({...ctx,db:tx},'ai_gateway.'+body.action,{type:'organization',id:ctx.orgId},undefined,{mode:body.mode});
    });
    return {token,settings:await state(ctx)};
  });
  async function authenticate(req:FastifyRequest,required?:string):Promise<GatewayAuth> {
    const match=/^Bearer (kk_(local|hosted)_[a-f0-9]{64})$/.exec(req.headers.authorization??'');
    if(!match)throw unauthorized();
    const hash=digest(match[1]!);
    const selected=mode.parse(match[2]);
    const local=selected==='local';
    const [r]=rows<{org_id:string;user_id:string;scopes:string[]}>(await deps.db.execute(sql`select g.org_id,m.user_id,case when ${local} then g.local_scopes else g.hosted_scopes end as scopes from ai_gateway_connections g join organization_memberships m on m.org_id=g.org_id and m.user_id=case when ${local} then g.local_owner else g.hosted_owner end join users u on u.id=m.user_id where g.enabled and g.mode=${selected} and (case when ${local} then g.local_hash else g.hosted_hash end)=${hash} and m.role='OWNER' and m.status='ACTIVE' and u.status='ACTIVE'`));
    if(!r)throw unauthorized();
    if(required&&!r.scopes.includes(required))throw forbidden('Gateway permission not enabled.');
    const ctx:Ctx={db:deps.db,env:deps.config.env,orgId:r.org_id,userId:r.user_id,actor:{type:'user',id:r.user_id},now:deps.now??(()=>new Date()),correlationId:req.correlationId,ip:req.ip};
    if(local)await deps.db.execute(sql`update ai_gateway_connections set local_seen=now() where org_id=${r.org_id} and local_hash=${hash}`);
    else await deps.db.execute(sql`update ai_gateway_connections set hosted_seen=now() where org_id=${r.org_id} and hosted_hash=${hash}`);
    await audit(ctx,'ai_gateway.request',{type:'organization',id:r.org_id},undefined,{mode:selected,method:req.method,path:req.url.split('?')[0]});
    return {ctx,mode:selected,hash,scopes:r.scopes};
  }
  const envelope=(req:FastifyRequest,data:unknown)=>({data,meta:{requestId:req.correlationId},error:null});
  async function invoke(auth:GatewayAuth,body:z.output<typeof invokeBody>) {
    const operation=lookup(body.operation);
    if(!auth.scopes.includes(operation.scope))throw forbidden('Gateway permission not enabled.');
    const input=operation.schema.parse(body.input);
    if(!operation.write)return operation.run(auth.ctx,input,'read-only');
    if(body.operation==='media.uploadImage'||body.operation==='media.uploadAudio') decodeMedia(input as {fileName:string;mime:string;base64:string},body.operation==='media.uploadImage'?'IMAGE':'AUDIO');
    if(!body.requestId)throw badRequest('A unique UUID requestId is required for writes.');
    const json=JSON.stringify(input);
    const mediaUpload=body.operation==='media.uploadImage'||body.operation==='media.uploadAudio';
    if(Buffer.byteLength(json,'utf8')>(mediaUpload?MAX_GATEWAY_MEDIA_JSON_BYTES:3000000))throw badRequest('Request too large.');
    const claimed=await auth.ctx.db.transaction(async tx=>{
      const [connection]=rows<{production_policy:unknown;active_scopes:string[]}>(await tx.execute(sql`select g.production_policy,case when g.mode='hosted' then g.hosted_scopes else g.local_scopes end as active_scopes from ai_gateway_connections g join organization_memberships m on m.org_id=g.org_id and m.user_id=case when g.mode='hosted' then g.hosted_owner else g.local_owner end join users u on u.id=m.user_id where g.org_id=${auth.ctx.orgId} and g.enabled and g.mode=${auth.mode} and (case when g.mode='hosted' then g.hosted_hash else g.local_hash end)=${auth.hash} and ${operation.scope}=any(case when g.mode='hosted' then g.hosted_scopes else g.local_scopes end) and m.role='OWNER' and m.status='ACTIVE' and u.status='ACTIVE' for update of g`));
      if(!connection)throw forbidden('Connector authorization changed.');
      const [existing]=rows<{id:string;status:string;result:unknown}>(await tx.execute(sql`select id,status,result from ai_gateway_requests where id=${body.requestId} and org_id=${auth.ctx.orgId} and mode=${auth.mode} and credential_hash=${auth.hash} and operation=${body.operation} and input=${json}::jsonb`));
      if(existing)return {row:existing,execute:false};
      const policy=auth.mode==='hosted'?productionPolicySchema.safeParse(connection.production_policy):null;
      const direct=canExecuteCreative(connection.active_scopes,body.operation);
      const trusted=direct?await authorizeCreative({...auth.ctx,db:tx},body.operation,input):policy?.success===true&&await authorizeProduction({...auth.ctx,db:tx},policy.data,body.operation,input);
      const [created]=rows<{id:string;status:string;result:unknown}>(await tx.execute(sql`insert into ai_gateway_requests(id,org_id,mode,credential_hash,operation,scope,input,status,policy_authorized) values(${body.requestId},${auth.ctx.orgId},${auth.mode},${auth.hash},${body.operation},${operation.scope},${json}::jsonb,${trusted?'RUNNING':'PENDING'},${trusted}) on conflict do nothing returning id,status,result`));
      if(!created)throw conflict('Request ID already used.');
      await audit({...auth.ctx,db:tx},trusted?'ai_gateway.policy_authorized':'ai_gateway.proposed',{type:'ai_gateway_request',id:created.id},undefined,{operation:body.operation,mode:auth.mode});
      if(!trusted)await notify(tx,{
        orgId:auth.ctx.orgId,userId:auth.ctx.userId,type:'gateway.approval',
        dedupeKey:'gateway.approval:'+created.id,title:'ChatGPT approval required',
        body:'A connector request needs your review within 30 minutes.',
        severity:'CRITICAL',deepLink:'/integrations?approval='+created.id,
        sourceType:'ai_gateway_request',sourceId:created.id,
      });
      return {row:created,execute:trusted};
    });
    if(!claimed.execute)return {...claimed.row,approvalRequired:claimed.row.status==='PENDING'};
    try{
      const result=await operation.run(auth.ctx,input,claimed.row.id,true);
      await auth.ctx.db.execute(sql`update ai_gateway_requests set status='COMPLETED',result=${JSON.stringify(result??null)}::jsonb,finished_at=now() where id=${claimed.row.id} and org_id=${auth.ctx.orgId}`);
      return {id:claimed.row.id,status:'COMPLETED',approvalRequired:false,result};
    }catch(e){
      await auth.ctx.db.execute(sql`update ai_gateway_requests set status='FAILED',result='{"message":"Trusted production operation failed. Inspect Kemokem before retrying."}'::jsonb,finished_at=now() where id=${claimed.row.id} and org_id=${auth.ctx.orgId}`);
      await audit(auth.ctx,'ai_gateway.failed',{type:'ai_gateway_request',id:claimed.row.id},undefined,{operation:body.operation});
      reqFailure(e);
    }
  }
  route({method:'GET',url:'/integrations/ai-gateway/requests',tag:'AI Gateway',summary:'Review requested operations',role:'OWNER'},async({ctx,reply})=>{
    reply.header('cache-control','no-store');
    // Avoid transmitting base64 thumbnails in the review list; the immutable input stays on the server.
    return rows(await ctx.db.execute(sql`select id,mode,operation,scope,input-'base64' as input,case when status='PENDING' and expires_at<=now() then 'EXPIRED' else status end as status,result,created_at,expires_at,finished_at from ai_gateway_requests where org_id=${ctx.orgId} order by (status='PENDING' and expires_at>now()) desc,created_at desc limit 200`));
  });
  route({method:'POST',url:'/integrations/ai-gateway/requests/:id/review',tag:'AI Gateway',summary:'Owner approves or rejects one immutable request',role:'OWNER',params:z.object({id:z.uuid()}),body:z.object({decision:z.enum(['approve','reject'])}).strict()},async({ctx,params,body,reply})=>{
    reply.header('cache-control','no-store');
    if(body.decision==='reject'){
      const [r]=rows(await ctx.db.execute(sql`update ai_gateway_requests set status='REJECTED',finished_at=now() where org_id=${ctx.orgId} and id=${params.id} and status='PENDING' returning id,status`));
      if(!r)throw conflict('Request is no longer pending.');
      await ctx.db.execute(sql`update notifications set read_at=coalesce(read_at,now()),archived_at=now() where org_id=${ctx.orgId} and source_type='ai_gateway_request' and source_id=${params.id}`);
      await audit(ctx,'ai_gateway.rejected',{type:'ai_gateway_request',id:params.id});
      return r;
    }
    // Claim once; the approved payload, active credential, scope and original owner must still match.
    const [r]=rows<RequestRow>(await ctx.db.execute(sql`update ai_gateway_requests q set status='RUNNING' from ai_gateway_connections g, organization_memberships m, users u where q.id=${params.id} and q.org_id=${ctx.orgId} and q.status='PENDING' and q.expires_at>now() and g.org_id=q.org_id and g.enabled and g.mode=q.mode and q.credential_hash=case when q.mode='local' then g.local_hash else g.hosted_hash end and q.scope=any(case when q.mode='local' then g.local_scopes else g.hosted_scopes end) and m.org_id=q.org_id and m.user_id=case when q.mode='local' then g.local_owner else g.hosted_owner end and m.role='OWNER' and m.status='ACTIVE' and u.id=m.user_id and u.status='ACTIVE' returning q.id,q.mode,q.operation,q.scope,q.input,q.status,q.result,q.created_at,q.expires_at,q.finished_at`));
    if(!r)throw conflict('Request expired, already reviewed, or connector authorization changed.');
    await ctx.db.execute(sql`update notifications set read_at=coalesce(read_at,now()),archived_at=now() where org_id=${ctx.orgId} and source_type='ai_gateway_request' and source_id=${r.id}`);
    try{
      const op=lookup(r.operation);
      if(!op.write||op.scope!==r.scope)throw forbidden('Operation changed.');
      await audit(ctx,'ai_gateway.approved',{type:'ai_gateway_request',id:r.id},undefined,{operation:r.operation});
      const result=await op.run(ctx,r.input,r.id);
      await ctx.db.execute(sql`update ai_gateway_requests set status='COMPLETED',result=${JSON.stringify(result??null)}::jsonb,finished_at=now() where id=${r.id} and org_id=${ctx.orgId}`);
      return {id:r.id,status:'COMPLETED'};
    }catch(e){
      // Never echo upstream secrets. Running/failed operations are not automatically retried.
      await ctx.db.execute(sql`update ai_gateway_requests set status='FAILED',result='{"message":"Operation failed. Check Kemokem before retrying."}'::jsonb,finished_at=now() where id=${r.id} and org_id=${ctx.orgId}`);
      await audit(ctx,'ai_gateway.failed',{type:'ai_gateway_request',id:r.id},undefined,{operation:r.operation});
      reqFailure(e);
    }
  });
  app.addHook('onSend',async(req,reply,payload)=>{if(req.url.split('?')[0]!.startsWith('/api/v1/ai-gateway/'))reply.header('cache-control','no-store');return payload;});
  app.get('/ai-gateway/status',async req=>{const a=await authenticate(req);return envelope(req,{mode:a.mode,scopes:a.scopes});});
  app.get('/ai-gateway/tools',async req=>{const a=await authenticate(req);return envelope(req,Object.entries(operations).filter(([,op])=>a.scopes.includes(op.scope)).map(([name,op])=>({name,scope:op.scope,approvalRequired:op.write,conditionalProductionAuthorization:op.write&&(productionOperations.includes(name)||creativeOperations.includes(name)),inputSchema:z.toJSONSchema(op.schema,{io:'input',unrepresentable:'any'})})));});
  app.post('/ai-gateway/invoke',{bodyLimit:Math.max(4*1024*1024,MAX_GATEWAY_INVOKE_BODY_BYTES),config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async req=>{const a=await authenticate(req);return envelope(req,await invoke(a,invokeBody.parse(req.body)));});
  app.get('/ai-gateway/requests/:id',async req=>{const a=await authenticate(req);const {id}=z.object({id:z.uuid()}).parse(req.params);const [r]=rows<RequestRow>(await a.ctx.db.execute(sql`select id,operation,scope,status,result,expires_at,finished_at from ai_gateway_requests where id=${id} and org_id=${a.ctx.orgId} and mode=${a.mode} and credential_hash=${a.hash}`));if(!r||!a.scopes.includes(r.scope))throw notFound('Request');return envelope(req,r);});
  // Keep legacy endpoints on the same permission, execution and request-id path.
  app.get('/ai-gateway/projects',async req=>envelope(req,await invoke(await authenticate(req),{operation:'projects.list',input:{}})));
  app.get('/ai-gateway/videos',async req=>envelope(req,await invoke(await authenticate(req),{operation:'media.list',input:{kind:'VIDEO'}})));
  app.get('/ai-gateway/videos/:id/analysis',async req=>envelope(req,await invoke(await authenticate(req),{operation:'media.analysis',input:req.params})));
  app.post('/ai-gateway/projects',async req=>{const p=z.object({title:z.string(),brief:z.string().optional(),requestId:z.uuid()}).strict().parse(req.body);return envelope(req,await invoke(await authenticate(req),{operation:'projects.create',input:{title:p.title,brief:p.brief},requestId:p.requestId}));});
}
