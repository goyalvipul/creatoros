import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from '@creatoros/db';
import {
  AGENT_EVENT, AGENT_SUBSCRIBE, AGENT_EXECUTE, agentTaskTypes, agentTaskInput,
  agentTaskClaim, agentTaskProgress, agentTaskComplete, agentTaskFail,
  checkAgentConnection, createAgentTask, claimAgentTask, getAgentTask, progressAgentTask,
  finishAgentTask, failAgentTask, withAgentTask, assertAgentClaim,
  type AgentAuth, badRequest, conflict, forbidden, notFound,
  encrypt, decrypt, verifyMcpCallback, callbackUrl, webhookKey,
} from '@creatoros/services';
import { z } from 'zod';
import { makeRouter, type AppDeps } from '../http';
import { operations } from './ai-gateway-operations';
import { binaryUploadSchema } from './ai-gateway-binary';
import { isDedicatedUploadRoot } from './ai-gateway-production-policy';

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const principal = z.string().trim().min(1).max(256);
const subId = z.string().regex(/^[a-f0-9]{64}$/);
const subscription = z.object({principal,url:z.string().max(2048),secret:z.string().max(120)}).strict();
const bound = agentTaskClaim.extend({principal});
const prefix = '/ai-gateway/agent-events/';
const admin = '/integrations/ai-gateway/agent-tasks';
type Authorize = (request: FastifyRequest, action: string, scopes: readonly string[]) => Promise<AgentAuth>;
export type AgentInvoke = (auth: AgentAuth, body: {operation:string;input:unknown;requestId?:string}, binding?:{taskId:string;claimToken:string}) => Promise<unknown>;

export function registerAgentEvents(app:FastifyInstance,deps:AppDeps,authorize:Authorize,
  envelope:(request:FastifyRequest,data:unknown)=>unknown,invoke:AgentInvoke) {
  const route=makeRouter(app,deps);
  const auth=(req:FastifyRequest,action:string)=>authorize(req,'agent.'+action,[AGENT_SUBSCRIBE,AGENT_EXECUTE]);
  function validatedUrl(raw:string) {
    try{return callbackUrl(raw).href;}catch{throw badRequest('Invalid callback URL.');}
  }
  app.post(prefix+'subscribe',{bodyLimit:8192,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async req=>{
    const a=await auth(req,'subscribe');const input=subscription.parse(req.body);const url=validatedUrl(input.url);
    try{webhookKey(input.secret);}catch{throw badRequest('Invalid callback signing key.');}
    const {ctx,hash}=a;
    const id=digest(JSON.stringify([ctx.orgId,ctx.userId,hash,input.principal,AGENT_EVENT,url]));
    const [existing]=rows<{secret_enc:string}>(await ctx.db.execute(sql`
      select secret_enc from mcp_agent_subscriptions where id=${id} and revoked_at is null
      and expires_at>now() and verified_at>now()-interval '24 hours'
    `));
    const key=ctx.env.encryptionKey;
    const cached=existing&&decrypt(existing.secret_enc,key)===input.secret;
    if(!cached){try{await verifyMcpCallback(url,id,input.secret);}catch{throw badRequest('Callback verification failed.',undefined,'MCP_CALLBACK_UNVERIFIED');}}
    const [saved]=await ctx.db.transaction(async tx=>{
      await checkAgentConnection(tx,a);
      if(cached)return rows<{expires_at:Date}>(await tx.execute(sql`
        update mcp_agent_subscriptions set expires_at=now()+interval '1 hour' where id=${id} and revoked_at is null
        and secret_enc=${existing.secret_enc} returning expires_at
      `));
      return rows<{expires_at:Date}>(await tx.execute(sql`
        insert into mcp_agent_subscriptions(id,org_id,owner_id,credential_hash,principal,callback_hash,callback_enc,secret_enc,verified_at,expires_at)
        values(${id},${ctx.orgId},${ctx.userId},${hash},${input.principal},${digest(url)},${encrypt(url,key)},${encrypt(input.secret,key)},now(),now()+interval '1 hour')
        on conflict(id) do update set callback_enc=excluded.callback_enc,secret_enc=excluded.secret_enc,
          verified_at=excluded.verified_at,expires_at=excluded.expires_at,revoked_at=null returning expires_at
      `));
    });
    if(!saved)throw conflict('Subscription changed during refresh.');
    return envelope(req,{id,refreshBefore:new Date(saved.expires_at).toISOString(),cursor:null,truncated:false});
  });
  app.post(prefix+'unsubscribe',{bodyLimit:8192},async req=>{
    const a=await auth(req,'unsubscribe');const input=subscription.omit({secret:true}).parse(req.body);
    await a.ctx.db.transaction(async tx=>{
      await checkAgentConnection(tx,a);
      await tx.execute(sql`update mcp_agent_subscriptions set revoked_at=now(),callback_enc=null,secret_enc=null
        where org_id=${a.ctx.orgId} and owner_id=${a.ctx.userId} and credential_hash=${a.hash}
        and principal=${input.principal} and callback_hash=${digest(validatedUrl(input.url))} and revoked_at is null`);
      await tx.execute(sql`update agent_tasks t set state='BLOCKED',terminal_at=now(),error_code='subscription_revoked',lease_until=null
        from mcp_agent_subscriptions s where s.id=t.subscription_id and s.org_id=${a.ctx.orgId}
        and s.owner_id=${a.ctx.userId} and s.credential_hash=${a.hash} and s.revoked_at is not null
        and t.state in ('QUEUED','DISPATCHED','DELIVERED','CLAIMED','RUNNING')`);
    });
    return envelope(req,{});
  });
  const options={bodyLimit:256*1024,config:{rateLimit:{max:60,timeWindow:'1 minute'}}};
  app.post(prefix+'capabilities',options,async req=>{
    const a=await auth(req,'capabilities');z.object({principal}).strict().parse(req.body);
    return envelope(req,{schemaVersion:1,taskTypes:agentTaskTypes,
      imageTransferConfigured:a.scopes.includes('media.upload.image')&&a.scopes.includes('references.read')&&
        await isDedicatedUploadRoot(a.ctx,a.ctx.env.processEnv?.AI_GATEWAY_CHATGPT_UPLOAD_ROOT_ID),
      hostCapabilitiesVerified:false,publishingAllowed:false});
  });
  app.post(prefix+'claim',options,async req=>{
    const a=await auth(req,'claim');const p=bound.strict().parse(req.body);
    return envelope(req,await claimAgentTask(a,p.principal,p.requestId,p.claimToken));
  });
  app.post(prefix+'get',options,async req=>{
    const a=await auth(req,'get');const p=bound.strict().parse(req.body);
    return envelope(req,await getAgentTask(a,p.principal,p.requestId,p.claimToken));
  });
  app.post(prefix+'progress',options,async req=>{
    const a=await auth(req,'progress');const p=agentTaskProgress.extend({principal}).strict().parse(req.body);
    return envelope(req,await progressAgentTask(a,p.principal,p.requestId,p.claimToken,p.detail));
  });
  app.post(prefix+'heartbeat',options,async req=>{
    const a=await auth(req,'heartbeat');const p=bound.strict().parse(req.body);
    return envelope(req,await progressAgentTask(a,p.principal,p.requestId,p.claimToken));
  });
  app.post(prefix+'complete',options,async req=>{
    const a=await auth(req,'complete');const p=agentTaskComplete.extend({principal}).strict().parse(req.body);
    return envelope(req,await finishAgentTask(a,p.principal,p.requestId,p.claimToken,p.result));
  });
  app.post(prefix+'fail',options,async req=>{
    const a=await auth(req,'fail');const p=agentTaskFail.extend({principal}).strict().parse(req.body);
    return envelope(req,await failAgentTask(a,p.principal,p.requestId,p.claimToken,p.code,p.detail));
  });
  app.post(prefix+'status',options,async req=>{
    const a=await auth(req,'status');const p=z.object({principal,requestId:z.uuid()}).strict().parse(req.body);
    const result=await withAgentTask(a,p.principal,p.requestId,async(_db,t)=>({requestId:t.id,state:t.state,result:t.result}));
    return envelope(req,result);
  });
  app.post(prefix+'reference',options,async req=>{
    const a=await auth(req,'reference');const p=bound.extend({fileId:z.uuid()}).strict().parse(req.body);
    if(!a.scopes.includes('references.read'))throw forbidden('Reference permission required.');
    await withAgentTask(a,p.principal,p.requestId,async(_db,t)=>{
      assertAgentClaim(t,p.claimToken);
      if(t.input.taskType!=='IMAGE_GENERATION'||!t.input.referenceFileIds.includes(p.fileId))throw forbidden('Reference is not assigned to this task.');
    });
    const op=operations['references.image']!;
    return envelope(req,await op.run(a.ctx,{id:p.fileId},'read-only'));
  });
  // Native binary media remains on the existing importer. Only the task's reserved ID,
  // project, creator and dedicated root may be used here. No arbitrary tool invocation.
  app.post(prefix+'prepare-image',options,async req=>{
    const a=await auth(req,'prepare-image');
    const p=bound.extend({image:binaryUploadSchema}).strict().parse(req.body);
    const task=await withAgentTask(a,p.principal,p.requestId,async(_db,t)=>{
      assertAgentClaim(t,p.claimToken);
      if(t.task_type!=='IMAGE_GENERATION'||!t.upload_request_id||p.image.brandId!==t.brand_id||p.image.projectId!==t.project_id||p.image.rootId!==t.upload_root_id)
        throw forbidden('Image target is not assigned to this task.');
      return t;
    });
    if(!await isDedicatedUploadRoot(a.ctx,p.image.rootId))throw forbidden('Use the dedicated image root.');
    return envelope(req,await invoke(a,{operation:'media.prepareImageUpload',input:p.image,requestId:task.upload_request_id!},
      {taskId:task.id,claimToken:p.claimToken}));
  });
  route({method:'GET',url:admin,tag:'AI Gateway',summary:'Agent task history',role:'OWNER'},async({ctx,reply})=>{
    reply.header('cache-control','no-store');
    return {
      subscriptions:rows(await ctx.db.execute(sql`
        select s.id,s.verified_at as "verifiedAt",s.expires_at as "expiresAt",s.revoked_at as "revokedAt"
        from mcp_agent_subscriptions s where s.org_id=${ctx.orgId} and s.owner_id=${ctx.userId} order by s.expires_at desc limit 30`)),
      tasks:rows(await ctx.db.execute(sql`
        select id,task_type as "taskType",state,brand_id as "brandId",project_id as "projectId",created_at as "createdAt",
          dispatched_at as "dispatchedAt",delivered_at as "deliveredAt",claimed_at as "claimedAt",
          completed_at as "completedAt",terminal_at as "terminalAt",attempts,progress,error_code as "errorCode",result
        from agent_tasks where org_id=${ctx.orgId} and owner_id=${ctx.userId} order by created_at desc limit 50`)),
      brands:rows(await ctx.db.execute(sql`
        select b.id,b.name,coalesce(p.reference_file_ids,'[]'::jsonb) as "referenceFileIds"
        from brands b left join ai_profiles p on p.org_id=b.org_id and p.brand_id=b.id
        where b.org_id=${ctx.orgId} and b.active and b.deleted_at is null order by b.name limit 100`)),
      projects:rows(await ctx.db.execute(sql`
        select id,title,brand_id as "brandId" from creative_projects where org_id=${ctx.orgId}
        and deleted_at is null and stage in ('DRAFT','IN_PROGRESS') order by created_at desc limit 100`)),
    };
  });
  route({method:'POST',url:admin,tag:'AI Gateway',summary:'Queue one owner-authorized agent task',role:'OWNER',
    body:z.object({subscriptionId:subId,requestId:z.uuid(),input:agentTaskInput}).strict(),
    rateLimit:{max:10,timeWindow:'1 minute'}},async({ctx,body})=>{
    if(body.input.taskType==='IMAGE_GENERATION'&&!await isDedicatedUploadRoot(ctx,ctx.env.processEnv?.AI_GATEWAY_CHATGPT_UPLOAD_ROOT_ID))
      throw badRequest('Dedicated image root is offline or not configured.');
    return createAgentTask(ctx,body.subscriptionId,body.requestId,body.input);
  });
  route({method:'POST',url:admin+'/:id/cancel',tag:'AI Gateway',summary:'Cancel a nonterminal agent task',role:'OWNER',
    params:z.object({id:z.uuid()})},async({ctx,params})=>{
    const [saved]=rows(await ctx.db.execute(sql`
      update agent_tasks set state='CANCELLED',terminal_at=now(),error_code='owner_cancelled',lease_until=null
      where id=${params.id} and org_id=${ctx.orgId} and owner_id=${ctx.userId}
        and state in ('QUEUED','DISPATCHED','DELIVERED','CLAIMED','RUNNING') returning id,state`));
    if(!saved)throw notFound('Active task');
    return saved;
  });
}
