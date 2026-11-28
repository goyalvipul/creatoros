import type { FastifyInstance } from 'fastify';
import { sql } from '@creatoros/db';
import { agentConfigSchema,saveAgentDefinition,enableAgentDefinition,startAgentRun,controlAgentRun,conflict,notFound,audit } from '@creatoros/services';
import { z } from 'zod';
import { makeRouter,type AppDeps } from '../http';

const rows=<T>(r:unknown)=>(r as {rows:T[]}).rows;
export function registerAgentStudio(app:FastifyInstance,deps:AppDeps){
 const route=makeRouter(app,deps),base='/integrations/ai-gateway/agent-studio';
 const params=z.object({id:z.uuid()});
 route({method:'GET',url:base,tag:'AI Gateway',summary:'Agent Studio dashboard',role:'OWNER'},async({ctx,reply})=>{
  reply.header('cache-control','no-store');
  const [connection]=rows<{exclusive:boolean}>(await ctx.db.execute(sql`select agent_exclusive as exclusive from ai_gateway_connections where org_id=${ctx.orgId}`));
  return {exclusive:connection?.exclusive===true,
   agents:rows(await ctx.db.execute(sql`select id,name,brand_id as "brandId",enabled,revision,config,last_error as "lastError",updated_at as "updatedAt" from agent_definitions
    where org_id=${ctx.orgId} and owner_id=${ctx.userId} order by name`)),
   runs:rows(await ctx.db.execute(sql`select id,agent_id as "agentId",slot,revision,state,stage,detail,project_id as "projectId",
    production_run_id as "productionRunId",plan_id as "planId",job_id as "jobId",file_id as "fileId",updated_at as "updatedAt"
    from agent_runs where org_id=${ctx.orgId} and owner_id=${ctx.userId} order by created_at desc limit 100`)),
   usage:rows(await ctx.db.execute(sql`select r.agent_id as "agentId",count(*)::int as tasks,count(*) filter(where t.task_type='IMAGE_GENERATION')::int as images,
    coalesce(sum((t.input->>'reservedCredits')::int) filter(where t.task_type='RESEARCH'),0)::int as "vidiqReserved"
    from agent_tasks t join agent_runs r on r.id=t.agent_run_id where r.org_id=${ctx.orgId} and r.owner_id=${ctx.userId}
    and t.created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver' group by r.agent_id`)),
   tasks:rows(await ctx.db.execute(sql`select t.id,t.agent_run_id as "runId",t.stage_key as "stageKey",t.state,t.progress,t.error_code as "errorCode",t.result
    from agent_tasks t join agent_runs r on r.id=t.agent_run_id where r.org_id=${ctx.orgId} and r.owner_id=${ctx.userId} order by t.created_at desc limit 100`)),
   events:rows(await ctx.db.execute(sql`select e.id::text,e.run_id as "runId",e.state,e.stage,e.detail,e.created_at as "createdAt" from agent_run_events e join agent_runs r on r.id=e.run_id where r.org_id=${ctx.orgId} and r.owner_id=${ctx.userId} order by e.id desc limit 300`)),
   brands:rows(await ctx.db.execute(sql`select id,name from brands where org_id=${ctx.orgId} and active and deleted_at is null order by name`)),
   projects:rows(await ctx.db.execute(sql`select id,title,brand_id as "brandId" from creative_projects where org_id=${ctx.orgId} and deleted_at is null and stage in ('DRAFT','IN_PROGRESS') order by created_at desc limit 100`)),
   workers:rows(await ctx.db.execute(sql`select id,label as name from gpu_workers where org_id=${ctx.orgId} and enabled order by label`)),
   subscriptions:rows(await ctx.db.execute(sql`select id,expires_at as "expiresAt" from mcp_agent_subscriptions where org_id=${ctx.orgId} and owner_id=${ctx.userId}
    and revoked_at is null and expires_at>now() and callback_enc is not null order by expires_at desc`)),
   provider:{vidiq:'HOST_REPORTED_OPT_IN_ONLY',ltx:'OWNER_AUDIO_AND_LIVE_ACCEPTANCE_REQUIRED',paidFallback:false,scheduledActivationRequiresCompletedRun:true}};
 });
 route({method:'POST',url:base+'/exclusive',tag:'AI Gateway',summary:'Select mutually exclusive hosted execution mode',role:'OWNER',
  body:z.object({enabled:z.boolean()}).strict()},async({ctx,body})=>ctx.db.transaction(async tx=>{
   await tx.execute(sql`select id from organizations where id=${ctx.orgId} for update`);
   const [g]=rows<{enabled:boolean;mode:string;hosted_owner:string;agent_exclusive:boolean;hosted_scopes:string[]}>(await tx.execute(sql`
     select enabled,mode,hosted_owner,agent_exclusive,hosted_scopes from ai_gateway_connections where org_id=${ctx.orgId} for update`));
   if(!g||g.hosted_owner!==ctx.userId)throw notFound('Hosted connector');
   if(body.enabled===g.agent_exclusive)return {exclusive:body.enabled};
   if(body.enabled){
    if(!g.enabled||g.mode!=='hosted'||!g.hosted_scopes.includes('agents.subscribe')||!g.hosted_scopes.includes('agents.execute'))throw conflict('Enable the hosted agent scopes first.');
    if(rows(await tx.execute(sql`select id from ai_gateway_requests where org_id=${ctx.orgId} and mode='hosted' and
     (status='RUNNING' or (operation in ('media.prepareImageUpload','media.prepareAudioUpload') and status='COMPLETED'
      and result->>'uploadState' in ('OPEN','RECEIVING') and (result->>'expiresAt')::timestamptz>now())) limit 1`)).length)
      throw conflict('Resolve active interactive requests and uploads before switching execution mode.');
    await tx.execute(sql`update ai_gateway_requests set status='REJECTED',finished_at=now() where org_id=${ctx.orgId} and mode='hosted' and status='PENDING'`);
   }else{
    if(rows(await tx.execute(sql`select id from agent_runs where org_id=${ctx.orgId} and state in ('ACTIVE','PAUSED') limit 1`)).length)
     throw conflict('Stop or finish active agent runs before restoring interactive access.');
    if(rows(await tx.execute(sql`select id from agent_tasks where org_id=${ctx.orgId} and state in ('QUEUED','DISPATCHED','DELIVERED','CLAIMED','RUNNING') limit 1`)).length)
     throw conflict('Resolve active agent tasks before restoring interactive access.');
    await tx.execute(sql`update agent_definitions set enabled=false,updated_at=now() where org_id=${ctx.orgId}`);
   }
   await tx.execute(sql`update ai_gateway_connections set agent_exclusive=${body.enabled} where org_id=${ctx.orgId}`);
   await audit({...ctx,db:tx},'agent.exclusive',{type:'organization',id:ctx.orgId},undefined,{enabled:body.enabled});
   return {exclusive:body.enabled};
 }));
 route({method:'POST',url:base+'/agents',tag:'AI Gateway',summary:'Create disabled agent',role:'OWNER',body:agentConfigSchema},async({ctx,body})=>saveAgentDefinition(ctx,body));
 route({method:'POST',url:base+'/agents/:id',tag:'AI Gateway',summary:'Save immutable agent configuration revision',role:'OWNER',params,body:agentConfigSchema},async({ctx,params,body})=>saveAgentDefinition(ctx,body,params.id));
 route({method:'POST',url:base+'/agents/:id/enable',tag:'AI Gateway',summary:'Enable or disable future agent schedules',role:'OWNER',params,body:z.object({enabled:z.boolean()}).strict()},async({ctx,params,body})=>enableAgentDefinition(ctx,params.id,body.enabled));
 route({method:'POST',url:base+'/agents/:id/run',tag:'AI Gateway',summary:'Start one native run for today',role:'OWNER',params},async({ctx,params})=>startAgentRun(ctx,params.id));
 route({method:'POST',url:base+'/runs/:id/control',tag:'AI Gateway',summary:'Control native run',role:'OWNER',params,body:z.object({action:z.enum(['pause','resume','stop'])}).strict()},async({ctx,params,body})=>controlAgentRun(ctx,params.id,body.action));
}
