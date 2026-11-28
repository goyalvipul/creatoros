import { createHash, randomUUID } from 'node:crypto';
import { sql, type Executor } from '@creatoros/db';
import { badRequest, conflict, forbidden, notFound, type Ctx } from './types';
import { decrypt } from './crypto';
import { sendMcpWebhook } from './mcp-event-webhook';
import { AGENT_SUBSCRIBE, AGENT_EXECUTE, agentTaskInput, agentEventPayload, agentTaskSchemaVersion, validateAgentResult, type AgentTaskInput, type AgentTaskResult } from './agent-task-contract';

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type AgentAuth = { ctx: Ctx; hash: string; mode: 'hosted' | 'local'; scopes: string[] };
export type AgentTask = {
  id: string; task_type: AgentTaskInput['taskType']; input: AgentTaskInput; state: string;
  claim_hash: string | null; lease_until: Date | null; deadline_at: Date;
  upload_request_id: string | null; result: AgentTaskResult | null; project_id: string | null;
  brand_id: string; creator_context: Record<string,unknown>; upload_root_id: string|null; frames_retrieved:boolean; run_state:string|null;
};

// All claim mutations are serialized against the active owner/credential. Never trust a
// task id or claim token alone, including after a connector permission change.
export async function checkAgentConnection(db: Executor, auth: AgentAuth) {
  if (auth.mode !== 'hosted' || !auth.scopes.includes(AGENT_SUBSCRIBE) || !auth.scopes.includes(AGENT_EXECUTE))
    throw forbidden('Hosted agent permissions are required.');
  if (!rows(await db.execute(sql`
    select g.org_id from ai_gateway_connections g
    join organization_memberships m on m.org_id=g.org_id and m.user_id=g.hosted_owner
    join users u on u.id=m.user_id
    where g.org_id=${auth.ctx.orgId} and g.enabled and g.mode='hosted'
      and g.hosted_owner=${auth.ctx.userId} and g.hosted_hash=${auth.hash}
      and ${AGENT_SUBSCRIBE}=any(g.hosted_scopes) and ${AGENT_EXECUTE}=any(g.hosted_scopes)
      and m.role='OWNER' and m.status='ACTIVE' and u.status='ACTIVE'
    for update of g
  `)).length) throw forbidden('Agent authorization changed.');
}

export async function createAgentTask(ctx: Ctx, subscriptionId: string, requestId: string, raw: AgentTaskInput, binding?:{runId:string;stageKey:string;dailyTasks:number;dailyImages:number}) {
  const input = agentTaskInput.parse(raw);
  return ctx.db.transaction(async tx => {
    // Lock the org row before counting and inserting task reservations.
    await tx.execute(sql`select id from organizations where id=${ctx.orgId} for update`);
    const [sub] = rows<{ credential_hash: string; principal: string }>(await tx.execute(sql`
      select s.credential_hash,s.principal from mcp_agent_subscriptions s
      join ai_gateway_connections g on g.org_id=s.org_id
      where s.id=${subscriptionId} and s.org_id=${ctx.orgId} and s.owner_id=${ctx.userId}
        and s.revoked_at is null and s.expires_at>now() and s.callback_enc is not null
        and g.enabled and g.mode='hosted' and g.hosted_hash=s.credential_hash and g.hosted_owner=s.owner_id
        and ${AGENT_SUBSCRIBE}=any(g.hosted_scopes) and ${AGENT_EXECUTE}=any(g.hosted_scopes)
      for update of s
    `));
    if (!sub) throw notFound('Active production subscription');
    const [existing] = rows<{ id: string }>(await tx.execute(sql`
      select id from agent_tasks where id=${requestId} and org_id=${ctx.orgId} and owner_id=${ctx.userId}
      and subscription_id=${subscriptionId} and input=${JSON.stringify(input)}::jsonb
    `));
    if (existing) return { requestId: existing.id };
    if(binding){
      const [run]=rows<{id:string;agent_id:string}>(await tx.execute(sql`
        select r.id,r.agent_id from agent_runs r join ai_gateway_connections g on g.org_id=r.org_id
        where r.id=${binding.runId} and r.org_id=${ctx.orgId} and r.owner_id=${ctx.userId} and r.brand_id=${input.brandId}
        and r.state='ACTIVE' and g.agent_exclusive and g.enabled and g.mode='hosted' and g.hosted_owner=r.owner_id
        and r.project_id is not distinct from ${input.projectId}::uuid for update of r
      `));
      if(!run)throw conflict('Assigned agent run is inactive or execution isolation is off.');
      const [usage]=rows<{tasks:number;images:number}>(await tx.execute(sql`
        select count(*)::int as tasks,count(*) filter(where t.task_type='IMAGE_GENERATION')::int as images
        from agent_tasks t join agent_runs r on r.id=t.agent_run_id where r.agent_id=${run.agent_id}
          and t.created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver'
      `));
      if((usage?.tasks??0)>=binding.dailyTasks||(input.taskType==='IMAGE_GENERATION'&&(usage?.images??0)>=binding.dailyImages))
        throw conflict('Agent daily task or image reservation exhausted.');
    }
    if(input.taskType==='VIDEO_REVIEW'||input.taskType==='SEO_GENERATION'){
      if(!rows(await tx.execute(sql`
        select j.id from generation_jobs j join generation_outputs o on o.job_id=j.id and o.org_id=j.org_id and (o.output_role='final' and j.provider='comfyui-h3' or o.output_role='original' and j.provider='comfyui-ltx' and j.settings->>'nativeAgentRunId' is not null)
        join file_instances f on f.id=o.file_instance_id and f.org_id=j.org_id
        where j.id=${input.jobId} and j.org_id=${ctx.orgId} and j.project_id=${input.projectId} and j.status='SUCCEEDED'
          and f.id=${input.fileId} and f.archived_at is null and f.availability='AVAILABLE' and f.file_type='VIDEO'
          and coalesce(j.settings->>'productionSuperseded','false')<>'true'
      `)).length)throw badRequest('Use the exact current indexed render.');
      if(input.taskType==='SEO_GENERATION'){
        for(const a of input.accounts){
          if(!rows(await tx.execute(sql`select a.id from social_accounts a join channels c on c.id=a.channel_id and c.org_id=a.org_id
            where a.id=${a.accountId} and a.org_id=${ctx.orgId} and c.brand_id=${input.brandId} and a.platform::text=${a.platform}
            and a.active and a.deleted_at is null and c.deleted_at is null`)).length)throw badRequest('Invalid creator account.');
        }
      }
    }
    if (!rows(await tx.execute(sql`select id from brands where org_id=${ctx.orgId} and id=${input.brandId} and active and deleted_at is null`)).length)
      throw notFound('Active creator');
    if (input.projectId && !rows(await tx.execute(sql`
      select id from creative_projects where org_id=${ctx.orgId} and id=${input.projectId}
      and brand_id=${input.brandId} and deleted_at is null and stage in ('DRAFT','IN_PROGRESS')
    `)).length) throw badRequest('Choose an active draft project belonging to the creator.');
    const [profile] = rows<{reference_file_ids:string[];character_name:string;character_notes:string;[key:string]:unknown}>(await tx.execute(sql`
      select name,niche,languages,tone,voice,themes,visual_notes,avoid,disclosure,character_name,character_notes,reference_file_ids
      from ai_profiles where org_id=${ctx.orgId} and brand_id=${input.brandId}
    `));
    let uploadRootId:string|null=null;
    if (input.taskType === 'IMAGE_GENERATION'||input.taskType==='VIDEO_REVIEW') {
      const canonical = profile?.reference_file_ids ?? [];
      if ((profile?.character_name || profile?.character_notes) && !canonical.length)
        throw badRequest('Add approved canonical character reference images first.');
      if (canonical.some((id,i) => input.referenceFileIds[i] !== id))
        throw badRequest('Canonical creator references must appear first and in their approved order.');
      // Explicit owner selection authorizes the extra scene references; all must be available.
      for (const id of input.referenceFileIds) {
        if (!rows(await tx.execute(sql`select id from file_instances where org_id=${ctx.orgId} and id=${id}
          and archived_at is null and availability='AVAILABLE' and file_type::text='IMAGE'`)).length)
          throw badRequest('Reference image is unavailable.');
      }
      if(input.taskType==='IMAGE_GENERATION'){
        const root = ctx.env.processEnv?.AI_GATEWAY_CHATGPT_UPLOAD_ROOT_ID;
        if (!root || !/^[0-9a-f-]{36}$/i.test(root)) throw badRequest('Configure the dedicated ChatGPT image upload root first.');
        uploadRootId=root;
      }
    }
    const [count] = rows<{ daily: number; active: number }>(await tx.execute(sql`
      select count(*) filter(where created_at>=date_trunc('day',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver')::int as daily,
      count(*) filter(where state in ('QUEUED','DISPATCHED','DELIVERED','CLAIMED','RUNNING'))::int as active
      from agent_tasks where org_id=${ctx.orgId}
    `));
    if ((count?.daily ?? 0)>=12 || (count?.active ?? 0)>=2) throw conflict('Agent task safety limit reached.');
    const [inserted] = rows<{ id: string }>(await tx.execute(sql`
      insert into agent_tasks(id,org_id,owner_id,subscription_id,credential_hash,principal,brand_id,project_id,task_type,input,creator_context,upload_root_id,upload_request_id,agent_run_id,stage_key)
      values(${requestId},${ctx.orgId},${ctx.userId},${subscriptionId},${sub.credential_hash},${sub.principal},
        ${input.brandId},${input.projectId},${input.taskType},${JSON.stringify(input)}::jsonb,${JSON.stringify(profile??{})}::jsonb,${uploadRootId},
        ${input.taskType==='IMAGE_GENERATION'?randomUUID():null},${binding?.runId??null},${binding?.stageKey??null})
      on conflict do nothing returning id
    `));
    if (!inserted) throw conflict('Task request ID is already used.');
    return { requestId: inserted.id };
  });
}

export async function withAgentTask<T>(auth: AgentAuth, principal: string, requestId: string, fn: (db: Executor, task: AgentTask) => Promise<T>) {
  return auth.ctx.db.transaction(async tx => {
    await checkAgentConnection(tx, auth);
    const [task] = rows<AgentTask>(await tx.execute(sql`
      select t.id,t.task_type,t.input,t.state,t.claim_hash,t.lease_until,t.deadline_at,t.upload_request_id,
        t.result,t.project_id,t.brand_id,t.creator_context,t.upload_root_id,t.frames_retrieved,r.state as run_state
      from agent_tasks t join mcp_agent_subscriptions s on s.id=t.subscription_id
      left join agent_runs r on r.id=t.agent_run_id
      where t.id=${requestId} and t.org_id=${auth.ctx.orgId} and t.owner_id=${auth.ctx.userId}
        and t.credential_hash=${auth.hash} and t.principal=${principal} and s.revoked_at is null
      for update of t
    `));
    if (!task) throw notFound('Agent task');
    if(task.run_state&&!['ACTIVE','PAUSED'].includes(task.run_state)&&task.state!=='COMPLETED')throw conflict('Assigned run is no longer active.');
    return fn(tx, task);
  });
}
export function assertAgentClaim(task: AgentTask, token: string) {
  if (task.claim_hash !== hash(token)) throw forbidden('Task claim does not match.');
  if (!['CLAIMED','RUNNING'].includes(task.state) || !task.lease_until ||
      new Date(task.lease_until).getTime() <= Date.now() || new Date(task.deadline_at).getTime() <= Date.now())
    throw conflict('Task claim is no longer active.');
}
export async function claimAgentTask(auth: AgentAuth, principal: string, requestId: string, token: string) {
  return withAgentTask(auth, principal, requestId, async (db, task) => {
    if (task.claim_hash === hash(token) && ['CLAIMED','RUNNING'].includes(task.state)) {
      assertAgentClaim(task,token);
      return { requestId, claimed: true };
    }
    if (task.run_state==='PAUSED'||!['DISPATCHED','DELIVERED'].includes(task.state) || task.claim_hash ||
        new Date(task.deadline_at).getTime() <= Date.now()) return { requestId, claimed: false, state: task.state };
    await db.execute(sql`
      update agent_tasks set state='CLAIMED',claim_hash=${hash(token)},claimed_at=now(),
        lease_until=least(deadline_at,now()+interval '15 minutes') where id=${requestId}
    `);
    return { requestId, claimed: true };
  });
}
export async function getAgentTask(auth: AgentAuth, principal: string, requestId: string, token: string) {
  return withAgentTask(auth, principal, requestId, async (_db, task) => {
    assertAgentClaim(task,token);
    return { requestId, input: task.input, uploadRequestId: task.upload_request_id,
      creatorContext: task.creator_context, uploadRootId: task.upload_root_id,
      deadlineAt: task.deadline_at, leaseUntil: task.lease_until, schemaVersion: agentTaskSchemaVersion(task.task_type) };
  });
}
export async function progressAgentTask(auth: AgentAuth, principal: string, requestId: string, token: string, detail?: string) {
  return withAgentTask(auth, principal, requestId, async (db, task) => {
    assertAgentClaim(task,token);
    await db.execute(sql`
      update agent_tasks set state='RUNNING',progress=coalesce(${detail??null},progress),
        lease_until=least(deadline_at,now()+interval '15 minutes') where id=${requestId}
    `);
    return { requestId, state: 'RUNNING' };
  });
}
export async function finishAgentTask(auth: AgentAuth, principal: string, requestId: string, token: string, raw: unknown) {
  return withAgentTask(auth, principal, requestId, async (db, task) => {
    let result:AgentTaskResult;
    try { result=validateAgentResult(task.input,raw); } catch { throw badRequest('Result does not match the assigned task schema.'); }
    if (task.state==='COMPLETED' && task.claim_hash===hash(token)) {
      if (rows(await db.execute(sql`select id from agent_tasks where id=${requestId} and result=${JSON.stringify(result)}::jsonb`)).length)
        return { requestId, state: 'COMPLETED' };
      throw conflict('Completed task has a different result.');
    }
    assertAgentClaim(task,token);
    if(result.taskType==='VIDEO_REVIEW'&&!task.frames_retrieved)throw conflict('Retrieve assigned render frames before reporting review.');
    if (result.taskType==='IMAGE_GENERATION') {
      if (result.uploadRequestId!==task.upload_request_id) throw badRequest('Use the task-bound upload session.');
      // The existing binary importer validates the bytes, MIME, exact length, SHA-256
      // and creator/project mapping before it records COMPLETE. A guessed library ID cannot pass.
      const [proof] = rows<{ file_id: string; size: number }>(await db.execute(sql`
        select f.id as file_id,f.size::float8 as size
        from ai_gateway_requests q join file_instances f on f.id=${result.fileId} and f.org_id=q.org_id
        where q.id=${result.uploadRequestId} and q.org_id=${auth.ctx.orgId}
          and q.mode='hosted' and q.credential_hash=${auth.hash}
          and q.operation='media.prepareImageUpload' and q.status='COMPLETED' and q.policy_authorized
          and q.result->>'uploadState'='COMPLETE' and q.result->'output'->>'fileId'=f.id::text
          and q.input->>'brandId'=${task.brand_id} and q.input->>'projectId'=${task.project_id}
          and q.input->>'rootId'=${task.upload_root_id}
          and q.result->'output'->>'brandId'=${task.brand_id} and q.result->'output'->>'projectId'=${task.project_id}
          and q.result->'output'->>'sha256'=q.input->>'sha256'
          and f.archived_at is null and f.availability='AVAILABLE' and f.file_type::text='IMAGE'
          and f.size>0 and f.size::text=q.input->>'size'
      `));
      if (!proof) throw conflict('Task image is not a verified completed upload.');
    }
    await db.execute(sql`
      update agent_tasks set state='COMPLETED',result=${JSON.stringify(result)}::jsonb,
        completed_at=now(),terminal_at=now(),lease_until=null where id=${requestId}
    `);
    return { requestId, state: 'COMPLETED' };
  });
}
export async function failAgentTask(auth: AgentAuth, principal: string, requestId: string, token: string, code: string, detail: string) {
  return withAgentTask(auth, principal, requestId, async (db, task) => {
    assertAgentClaim(task,token);
    await db.execute(sql`update agent_tasks set state='FAILED',error_code=${code},progress=${detail},
      terminal_at=now(),lease_until=null where id=${requestId}`);
    return { requestId, state: 'FAILED' };
  });
}

type Delivery = { id:string; subscription_id:string; task_type:AgentTaskInput['taskType']; created_at:Date;
  attempts:number; callback_enc:string; secret_enc:string };
export async function dispatchMcpAgentTasks(db: Executor, key: Buffer) {
  // Inactive credentials invalidate the production subscription and all nonterminal work.
  await db.execute(sql`
    update mcp_agent_subscriptions s set revoked_at=now(),callback_enc=null,secret_enc=null
    where revoked_at is null and not exists (
      select 1 from ai_gateway_connections g
      join organization_memberships m on m.org_id=g.org_id and m.user_id=g.hosted_owner
      join users u on u.id=m.user_id
      where g.org_id=s.org_id and g.enabled and g.mode='hosted' and g.hosted_hash=s.credential_hash
      and g.hosted_owner=s.owner_id and ${AGENT_SUBSCRIBE}=any(g.hosted_scopes)
      and ${AGENT_EXECUTE}=any(g.hosted_scopes) and m.role='OWNER' and m.status='ACTIVE' and u.status='ACTIVE')
  `);
  await db.execute(sql`update mcp_agent_subscriptions set callback_enc=null,secret_enc=null
    where expires_at<=now() and secret_enc is not null`);
  await db.execute(sql`
    update agent_tasks t set state=case when s.revoked_at is not null then 'BLOCKED' else 'TIMED_OUT' end,
      error_code=case when s.revoked_at is not null then 'subscription_revoked' else 'task_timeout' end,
      terminal_at=now(),lease_until=null
    from mcp_agent_subscriptions s where s.id=t.subscription_id
    and t.state in ('QUEUED','DISPATCHED','DELIVERED','CLAIMED','RUNNING')
    and (s.revoked_at is not null or (t.deadline_at<=now() and not (t.state='QUEUED' and t.attempts=0 and exists(select 1 from agent_runs r where r.id=t.agent_run_id and r.state='PAUSED')))
      or (t.state in ('QUEUED','DISPATCHED') and s.expires_at<=now())
      or (t.state in ('CLAIMED','RUNNING') and t.lease_until<=now()))
  `);
  // Expired claims are terminal. Never automatically redo creative work whose outcome is uncertain.
  await db.execute(sql`
    update agent_tasks set state='FAILED',error_code='delivery_attempts_exhausted',terminal_at=now()
    where state in ('QUEUED','DISPATCHED') and attempts>=4 and next_attempt_at<=now()
  `);
  const [delivery] = rows<Delivery>(await db.execute(sql`
    with next as (
      select t.id,s.callback_enc,s.secret_enc from agent_tasks t
      join mcp_agent_subscriptions s on s.id=t.subscription_id
      join ai_gateway_connections g on g.org_id=t.org_id
      join organization_memberships m on m.org_id=g.org_id and m.user_id=g.hosted_owner
      join users u on u.id=m.user_id
      where t.state in ('QUEUED','DISPATCHED') and t.claim_hash is null
      and (t.agent_run_id is null or exists(select 1 from agent_runs r where r.id=t.agent_run_id and r.state='ACTIVE' and g.agent_exclusive))
      and t.next_attempt_at<=now() and t.deadline_at>now() and t.attempts<4
      and s.revoked_at is null and s.expires_at>now() and s.callback_enc is not null and s.secret_enc is not null
      and g.enabled and g.mode='hosted' and g.hosted_hash=t.credential_hash and g.hosted_owner=t.owner_id
      and ${AGENT_SUBSCRIBE}=any(g.hosted_scopes) and ${AGENT_EXECUTE}=any(g.hosted_scopes)
      and m.role='OWNER' and m.status='ACTIVE' and u.status='ACTIVE'
      order by t.next_attempt_at,t.id limit 1 for update of t skip locked
    )
    update agent_tasks t set state='DISPATCHED',dispatched_at=now(),attempts=attempts+1,
      next_attempt_at=now()+interval '2 minutes' from next where next.id=t.id
    returning t.id,t.subscription_id,t.task_type,t.created_at,t.attempts,next.callback_enc,next.secret_enc
  `));
  if (!delivery) return { dispatched: false };
  let ok=false, retry=false, error='callback_http_error';
  try {
    const response=await sendMcpWebhook(decrypt(delivery.callback_enc,key),delivery.subscription_id,
      decrypt(delivery.secret_enc,key),delivery.id,agentEventPayload(delivery.id,delivery.task_type,new Date(delivery.created_at)));
    ok=response.status>=200&&response.status<300;
    retry=response.status===429||response.status>=500;
  } catch { error='callback_transport_error'; retry=true; }
  await db.execute(sql`
    update agent_tasks set delivered_at=case when ${ok} then now() else delivered_at end,
      state=case when state<>'DISPATCHED' then state when ${ok} then 'DELIVERED'
        when ${!retry||delivery.attempts>=4} then 'FAILED' else state end,
      error_code=case when state<>'DISPATCHED' then error_code when ${ok} then null else ${error} end,
      terminal_at=case when state='DISPATCHED' and ${!ok&&(!retry||delivery.attempts>=4)} then now() else terminal_at end,
      next_attempt_at=now()+(${delivery.attempts}*interval '30 seconds')
    where id=${delivery.id} and attempts=${delivery.attempts}
  `);
  return { dispatched: true };
}
