import {
  and,
  conversationThreads,
  desc,
  eq,
  inboundClassifications,
  internalActions,
  isNull,
  messages,
  providerConnections,
  providerWebhookEvents,
  settingsAndFeatureFlags,
  socialOutboundMessages,
  sql,
  workflowApprovals,
  workflowExecutions,
  workflows,
  workflowVersions,
  type Db,
} from '@creatoros/db';
import { parseInstagramWebhookEntry, type ConnectorContext } from '@creatoros/connectors';
import {
  WORKFLOW_MODE,
  dmWindowOpen,
  evaluateCondition,
  renderTemplate,
  sensitiveTopics,
  validateDefinition,
  type Action,
  type EventForMatch,
  type ExecutionStatus,
  type WorkflowDefinition,
  type WorkflowMode,
} from '@creatoros/domain';
import { audit } from './audit';
import { redact } from './crypto';
import { notify } from './notifications';
import { triageThread } from './crm';
import {
  PLATFORM_NAMES,
  accountSettings,
  createOutboundDraft,
  ingestSocialEvent,
  sendOutbound,
  type SocialEvent,
} from './social';
import { AppError, badRequest, conflict, notFound, systemCtx, type Ctx, type ServiceEnv } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
type Workflow = typeof workflows.$inferSelect;
type Version = typeof workflowVersions.$inferSelect;

// ------------------------------------------------------------------ settings / kill switch

const PAUSE_KEY = 'workflows.pause_all_sending';

export async function sendingPaused(db: Db, orgId: string): Promise<boolean> {
  const [s] = await db
    .select()
    .from(settingsAndFeatureFlags)
    .where(
      and(
        eq(settingsAndFeatureFlags.orgId, orgId),
        eq(settingsAndFeatureFlags.scope, 'org'),
        eq(settingsAndFeatureFlags.key, PAUSE_KEY),
      ),
    );
  return Boolean(s?.enabled && (s.value as any)?.paused === true);
}

/** Emergency stop. While on, no workflow sends anything; blocked runs are recorded, never silently dropped. */
export async function setPauseAllSending(ctx: Ctx, paused: boolean) {
  await ctx.db
    .insert(settingsAndFeatureFlags)
    .values({
      orgId: ctx.orgId,
      scope: 'org',
      key: PAUSE_KEY,
      value: { paused, at: new Date().toISOString() },
    })
    .onConflictDoUpdate({
      target: [settingsAndFeatureFlags.orgId, settingsAndFeatureFlags.scope, settingsAndFeatureFlags.key],
      set: { value: { paused, at: new Date().toISOString() }, enabled: true, updatedAt: new Date() },
    });
  await audit(ctx, paused ? 'workflows.pause_all' : 'workflows.resume_all', { type: 'org', id: ctx.orgId });
  return { pauseAllSending: paused };
}

// ------------------------------------------------------------------ definitions and versions

async function checkScope(db: Db, orgId: string, connectionIds: string[]) {
  const unique = [...new Set(connectionIds)];
  if (!unique.length) return unique;
  const rows = await db
    .select({ id: providerConnections.id, provider: providerConnections.provider })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.orgId, orgId),
        sql`${providerConnections.id} in (${sql.join(
          unique.map((i) => sql`${i}::uuid`),
          sql`, `,
        )})`,
      ),
    );
  if (rows.length !== unique.length || rows.some((r) => r.provider !== 'instagram'))
    throw badRequest(
      'Every selected account must be one of your connected social accounts.',
      undefined,
      'INVALID_ACCOUNT_SCOPE',
    );
  return unique;
}

function validated(def: unknown, mode: WorkflowMode): WorkflowDefinition {
  const v = validateDefinition(def, mode);
  if (!v.ok) throw badRequest('The workflow is not valid.', v.issues, 'INVALID_WORKFLOW');
  return v.def;
}

export async function createWorkflow(
  ctx: Ctx,
  input: {
    name: string;
    description?: string | null;
    mode: WorkflowMode;
    connectionIds: string[];
    definition: unknown;
    note?: string;
  },
) {
  if (!input.name.trim()) throw badRequest('Name is required');
  if (!WORKFLOW_MODE.includes(input.mode)) throw badRequest('Unknown mode');
  const def = validated(input.definition, input.mode);
  const scope = await checkScope(ctx.db, ctx.orgId, input.connectionIds);
  return ctx.db.transaction(async (tx) => {
    const [wf] = await tx
      .insert(workflows)
      .values({
        orgId: ctx.orgId,
        name: input.name.trim().slice(0, 120),
        description: input.description ?? null,
        mode: input.mode,
        connectionIds: scope,
        createdBy: ctx.userId,
      })
      .returning();
    await tx.insert(workflowVersions).values({
      workflowId: wf!.id,
      version: 1,
      mode: input.mode,
      definition: def as any,
      note: input.note ?? 'Created',
      createdBy: ctx.userId,
    });
    await audit({ ...ctx, db: tx }, 'workflow.create', { type: 'workflow', id: wf!.id });
    return wf!;
  });
}

async function loadWorkflow(db: Db, orgId: string, id: string): Promise<Workflow> {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.orgId, orgId), isNull(workflows.deletedAt)));
  if (!wf) throw notFound('Workflow');
  return wf;
}

async function versionRow(db: Db, workflowId: string, version: number) {
  const [v] = await db
    .select()
    .from(workflowVersions)
    .where(and(eq(workflowVersions.workflowId, workflowId), eq(workflowVersions.version, version)));
  return v;
}

/** Editing creates a new version. The published (active) version keeps running until you activate again. */
export async function updateWorkflow(
  ctx: Ctx,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    mode?: WorkflowMode;
    connectionIds?: string[];
    definition?: unknown;
    note?: string;
  },
) {
  const wf = await loadWorkflow(ctx.db, ctx.orgId, id);
  const latest = (await versionRow(ctx.db, id, wf.latestVersion))!;
  const set: Partial<typeof workflows.$inferInsert> = { updatedAt: new Date() };
  if (patch.name?.trim()) set.name = patch.name.trim().slice(0, 120);
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.connectionIds) set.connectionIds = await checkScope(ctx.db, ctx.orgId, patch.connectionIds);
  const mode = patch.mode ?? (latest.mode as WorkflowMode);
  if (patch.definition !== undefined || patch.mode) {
    const def = validated(patch.definition ?? latest.definition, mode);
    const next = wf.latestVersion + 1;
    await ctx.db.insert(workflowVersions).values({
      workflowId: id,
      version: next,
      mode,
      definition: def as any,
      note: patch.note ?? 'Edited',
      createdBy: ctx.userId,
    });
    set.latestVersion = next;
    set.mode = mode;
    // a changed workflow must be tested again before it can run fully automatically
    set.testedAt = null;
    set.testedVersion = null;
  }
  await ctx.db.update(workflows).set(set).where(eq(workflows.id, id));
  await audit(ctx, 'workflow.update', { type: 'workflow', id }, undefined, { fields: Object.keys(patch) });
  return loadWorkflow(ctx.db, ctx.orgId, id);
}

export async function activateWorkflow(ctx: Ctx, id: string) {
  const wf = await loadWorkflow(ctx.db, ctx.orgId, id);
  const v = (await versionRow(ctx.db, id, wf.latestVersion))!;
  const mode = v.mode as WorkflowMode;
  validated(v.definition, mode);
  if (!wf.connectionIds.length)
    throw badRequest('Choose at least one account before activating.', undefined, 'NO_ACCOUNT_SCOPE');
  if (mode === 'AUTOMATIC' && wf.testedVersion !== wf.latestVersion)
    throw badRequest(
      'Run a successful test (dry run) of this exact version before enabling Fully Automatic mode.',
      undefined,
      'TEST_REQUIRED',
    );
  await ctx.db
    .update(workflows)
    .set({
      status: 'ACTIVE',
      activeVersionId: v.id,
      pauseReason: null,
      consecutiveFailures: 0,
      updatedAt: new Date(),
    })
    .where(eq(workflows.id, id));
  await audit(ctx, 'workflow.activate', { type: 'workflow', id }, undefined, { version: v.version, mode });
  return loadWorkflow(ctx.db, ctx.orgId, id);
}

export async function pauseWorkflow(ctx: Ctx, id: string, reason = 'Paused by you') {
  await loadWorkflow(ctx.db, ctx.orgId, id);
  await ctx.db
    .update(workflows)
    .set({ status: 'PAUSED', pauseReason: reason, updatedAt: new Date() })
    .where(eq(workflows.id, id));
  await audit(ctx, 'workflow.pause', { type: 'workflow', id });
  return loadWorkflow(ctx.db, ctx.orgId, id);
}

export async function rollbackWorkflow(ctx: Ctx, id: string, version: number) {
  const wf = await loadWorkflow(ctx.db, ctx.orgId, id);
  const old = await versionRow(ctx.db, id, version);
  if (!old) throw notFound('Version');
  return updateWorkflow(ctx, wf.id, {
    mode: old.mode as WorkflowMode,
    definition: old.definition,
    note: `Rolled back to v${version}`,
  });
}

export async function duplicateWorkflow(ctx: Ctx, id: string) {
  const wf = await loadWorkflow(ctx.db, ctx.orgId, id);
  const v = (await versionRow(ctx.db, id, wf.latestVersion))!;
  return createWorkflow(ctx, {
    name: `${wf.name} (copy)`,
    description: wf.description,
    mode: v.mode as WorkflowMode,
    connectionIds: [],
    definition: v.definition,
    note: `Copied from ${wf.name}`,
  });
}

export async function exportWorkflow(ctx: Ctx, id: string) {
  const wf = await loadWorkflow(ctx.db, ctx.orgId, id);
  const v = (await versionRow(ctx.db, id, wf.latestVersion))!;
  // accounts are never exported: an import must be scoped to accounts deliberately
  return {
    format: 'creatoros.workflow/1',
    name: wf.name,
    description: wf.description,
    mode: v.mode,
    definition: v.definition,
  };
}

export async function importWorkflow(
  ctx: Ctx,
  input: { name: string; description?: string | null; mode: WorkflowMode; definition: unknown },
) {
  return createWorkflow(ctx, { ...input, connectionIds: [], note: 'Imported' });
}

export async function deleteWorkflow(ctx: Ctx, id: string) {
  await loadWorkflow(ctx.db, ctx.orgId, id);
  await ctx.db
    .update(workflows)
    .set({ deletedAt: new Date(), status: 'PAUSED', pauseReason: 'Deleted' })
    .where(eq(workflows.id, id));
  await audit(ctx, 'workflow.delete', { type: 'workflow', id });
  return { ok: true };
}

export async function listWorkflows(ctx: Ctx) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select w.id, w.name, w.description, w.mode, w.status, w.connection_ids as "connectionIds", w.latest_version as "latestVersion",
             w.active_version_id is not null as published, w.tested_version as "testedVersion", w.pause_reason as "pauseReason", w.updated_at as "updatedAt",
             (select count(*)::int from workflow_executions e where e.workflow_id = w.id and not e.is_simulation and e.started_at > now() - interval '24 hours') as "runs24h",
             (select count(*)::int from workflow_approvals a where a.workflow_id = w.id and a.state in ('PENDING','SNOOZED')) as "pendingApprovals"
      from workflows w where w.org_id = ${ctx.orgId} and w.deleted_at is null order by w.updated_at desc`),
  );
}

export async function getWorkflow(ctx: Ctx, id: string) {
  const wf = await loadWorkflow(ctx.db, ctx.orgId, id);
  const versions = await ctx.db
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, id))
    .orderBy(desc(workflowVersions.version));
  return {
    ...wf,
    versions,
    definition: versions.find((v) => v.version === wf.latestVersion)?.definition ?? null,
  };
}

export async function workflowOverview(ctx: Ctx) {
  const [r] = rowsOf<any>(
    await ctx.db.execute(sql`
      select
        (select count(*)::int from workflows where org_id = ${ctx.orgId} and deleted_at is null and status = 'ACTIVE') as active,
        (select count(*)::int from workflows where org_id = ${ctx.orgId} and deleted_at is null and status = 'PAUSED') as paused,
        (select count(*)::int from workflow_executions where org_id = ${ctx.orgId} and not is_simulation and started_at > now() - interval '24 hours') as "executions24h",
        (select count(*)::int from social_outbound_messages where org_id = ${ctx.orgId} and source = 'WORKFLOW' and state = 'SENT' and sent_at > now() - interval '24 hours') as "autoReplies24h",
        (select count(*)::int from workflow_approvals where org_id = ${ctx.orgId} and state in ('PENDING','SNOOZED')) as "pendingApprovals",
        (select count(*)::int from workflow_executions where org_id = ${ctx.orgId} and not is_simulation and status = 'FAILED' and started_at > now() - interval '24 hours') as "failed24h",
        (select count(*)::int from provider_connections where org_id = ${ctx.orgId} and provider = 'instagram' and state = 'AUTH_EXPIRED') as "needReconnect"`),
  );
  return { ...r, pauseAllSending: await sendingPaused(ctx.db, ctx.orgId) };
}

// ------------------------------------------------------------------ engine

export interface EngineEvent {
  eventKey: string;
  connectionId: string;
  threadId: string | null; // null for synthetic simulation events
  messageId: string | null;
  kind: 'DM' | 'COMMENT';
  text: string;
  senderId: string;
  senderName: string | null;
  hasMedia: boolean;
  isNewConversation: boolean;
  receivedAt: Date;
  isLive: boolean;
  category?: string | null;
  confidence?: number | null;
}

interface TraceEntry {
  step: string;
  type: string;
  result: 'PASS' | 'FAIL' | 'DONE' | 'WOULD' | 'BLOCKED' | 'DOWNGRADED' | 'SKIPPED' | 'ERROR';
  detail: string;
}

interface RunResult {
  status: ExecutionStatus;
  outcome: string;
  trace: TraceEntry[];
  approvalId?: string;
  outboundId?: string;
}

class Stop extends Error {
  constructor(
    readonly status: ExecutionStatus,
    readonly outcome: string,
  ) {
    super(outcome);
  }
}

export async function executeWorkflow(
  db: Db,
  env: ServiceEnv,
  wf: Workflow,
  ver: Version,
  ev: EngineEvent,
  opts: { simulate: boolean; executionId?: string; overrides?: Partial<ConnectorContext> },
): Promise<RunResult> {
  const def = ver.definition as unknown as WorkflowDefinition;
  const mode = ver.mode as WorkflowMode;
  const sim = opts.simulate;
  const trace: TraceEntry[] = [];
  const add = (step: string, type: string, result: TraceEntry['result'], detail: string) =>
    trace.push({ step, type, result, detail });
  const [conn] = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.id, ev.connectionId));
  const [org] = rowsOf<{ timezone: string }>(
    await db.execute(sql`select timezone from organizations where id = ${wf.orgId}`),
  );
  const thread = ev.threadId
    ? (await db.select().from(conversationThreads).where(eq(conversationThreads.id, ev.threadId)))[0]
    : undefined;
  if (!conn || conn.orgId !== wf.orgId) return { status: 'BLOCKED', outcome: 'account not found', trace };
  if (!wf.connectionIds.includes(ev.connectionId)) {
    add('scope', 'scope', 'BLOCKED', 'This workflow is not scoped to the account that received the message.');
    return { status: 'BLOCKED', outcome: 'account not in workflow scope', trace };
  }
  if (!sim && !ev.isLive) {
    add('trigger', 'trigger', 'SKIPPED', 'Historical or stale event: stored, but never triggers automation.');
    return { status: 'SKIPPED', outcome: 'historical event', trace };
  }
  const expected = def.trigger.event === 'MESSAGE_RECEIVED' ? 'DM' : 'COMMENT';
  if (ev.kind !== expected) {
    add('trigger', 'trigger', 'FAIL', `Workflow listens for ${def.trigger.event}, event is ${ev.kind}.`);
    return { status: 'SKIPPED', outcome: 'trigger does not match', trace };
  }
  add('trigger', 'trigger', 'PASS', `${def.trigger.event} on ${conn.label ?? conn.principalHint}`);

  const match: EventForMatch = {
    event: def.trigger.event,
    text: ev.text,
    senderId: ev.senderId,
    hasMedia: ev.hasMedia,
    isNewConversation: ev.isNewConversation,
    receivedAt: ev.receivedAt,
    timezone: org?.timezone ?? 'UTC',
    category: ev.category,
    confidence: ev.confidence,
  };
  const settings = accountSettings(conn);
  const username = ((conn.config as any)?.username as string | undefined) ?? null;
  let status: ExecutionStatus = 'COMPLETED';
  let outcome = 'completed';
  let approvalId: string | undefined;
  let outboundId: string | undefined;

  /** Checks shared by every action that produces a message for a person. Returns a reason string when blocked. */
  const messageGate = async (): Promise<string | null> => {
    if (!ev.isLive && !sim) return 'event is historical';
    if (thread) {
      if (thread.optedOut) return 'sender opted out of automated messages';
      if (thread.lastOutboundAt && thread.lastOutboundAt > ev.receivedAt)
        return 'you already replied to this conversation';
      if (ev.kind === 'DM' && !dmWindowOpen(thread.lastInboundAt, new Date()))
        return 'the 24 hour reply window is closed';
    } else if (!sim) return 'conversation missing';
    return null;
  };

  const queueForApproval = async (stepId: string, text: string, reason: string) => {
    if (sim || !thread || !opts.executionId) {
      add(
        stepId,
        'queue_approval',
        'WOULD',
        `Queue for approval as ${username ? '@' + username : conn.principalHint}: "${text.slice(0, 120)}" (${reason})`,
      );
      status = 'AWAITING_APPROVAL';
      outcome = 'awaiting approval (simulated)';
      return;
    }
    const [a] = await db
      .insert(workflowApprovals)
      .values({
        orgId: wf.orgId,
        executionId: opts.executionId,
        workflowId: wf.id,
        threadId: thread.id,
        connectionId: conn.id,
        recipientId: thread.participantId ?? ev.senderId,
        kind: ev.kind === 'COMMENT' ? 'COMMENT_REPLY' : 'DM',
        proposedText: text,
        reason,
      })
      .onConflictDoNothing()
      .returning({ id: workflowApprovals.id });
    approvalId = a?.id;
    add(stepId, 'queue_approval', 'DONE', `Waiting for your approval (${reason})`);
    status = 'AWAITING_APPROVAL';
    outcome = 'awaiting approval';
    if (a)
      await notify(db, {
        orgId: wf.orgId,
        type: 'workflow.approval',
        dedupeKey: `wf-approval:${a.id}`,
        title: `Reply waiting for approval (${username ? '@' + username : 'Instagram'})`,
        body: text.slice(0, 200),
        deepLink: '/workflows/approvals',
      });
  };

  try {
    for (const step of def.steps) {
      if (step.kind === 'condition') {
        const r = evaluateCondition(step.condition, match);
        add(step.id, step.condition.type, r.pass ? 'PASS' : 'FAIL', r.reason);
        if (!r.pass) throw new Stop('SKIPPED', `condition "${step.condition.type}" not met`);
        continue;
      }
      const a: Action = step.action;
      const ctxT = {
        senderDisplayName: ev.senderName,
        accountUsername: username,
        platformName: PLATFORM_NAMES.INSTAGRAM!,
        messageText: ev.text,
        conversationId: ev.threadId ?? 'simulated',
        receivedAt: ev.receivedAt,
      };
      switch (a.type) {
        case 'stop':
          add(step.id, 'stop', 'DONE', 'Stopped by workflow');
          throw new Stop('COMPLETED', 'stopped by workflow');
        case 'add_label':
        case 'set_priority':
        case 'mark_human_review':
        case 'create_task':
        case 'notify':
        case 'create_lead': {
          if (sim || !thread) {
            add(step.id, a.type, 'WOULD', JSON.stringify(redact(a)).slice(0, 200));
            break;
          }
          if (a.type === 'add_label')
            await db
              .update(conversationThreads)
              .set({
                labels: sql`case when ${a.label} = any(labels) then labels else array_append(labels, ${a.label}) end`,
              })
              .where(eq(conversationThreads.id, thread.id));
          if (a.type === 'set_priority')
            await db
              .update(conversationThreads)
              .set({ priority: a.priority })
              .where(eq(conversationThreads.id, thread.id));
          if (a.type === 'mark_human_review') {
            await db
              .update(conversationThreads)
              .set({
                priority: 'HIGH',
                labels: sql`case when 'needs-human' = any(labels) then labels else array_append(labels, 'needs-human') end`,
              })
              .where(eq(conversationThreads.id, thread.id));
            await notify(db, {
              orgId: wf.orgId,
              type: 'workflow.review',
              dedupeKey: `wf-review:${wf.id}:${ev.eventKey}`,
              title: 'A conversation needs your review',
              body: a.reason ?? ev.text.slice(0, 160),
              severity: 'WARNING',
              deepLink: `/socials/inbox?thread=${thread.id}`,
            });
          }
          if (a.type === 'create_task')
            await db
              .insert(internalActions)
              .values({
                orgId: wf.orgId,
                sourceType: 'workflow',
                sourceId: thread.id,
                dedupeKey: `wf:${wf.id}:${ev.eventKey}:${step.id}`,
                title: a.title,
                deepLink: `/socials/inbox?thread=${thread.id}`,
                dueAt: a.dueInHours ? new Date(Date.now() + a.dueInHours * 3_600_000) : null,
                reason: `Workflow: ${wf.name}`,
              })
              .onConflictDoNothing();
          if (a.type === 'notify')
            await notify(db, {
              orgId: wf.orgId,
              type: 'workflow.notice',
              dedupeKey: `wf-notice:${wf.id}:${ev.eventKey}:${step.id}`,
              title: a.title,
              body: ev.text.slice(0, 160),
              deepLink: `/socials/inbox?thread=${thread.id}`,
            });
          if (a.type === 'create_lead')
            await triageThread(systemCtx({ db, env }, wf.orgId), thread.id, 'CONFIRMED');
          add(step.id, a.type, 'DONE', 'Done');
          break;
        }
        case 'draft_reply':
        case 'queue_approval':
        case 'send_reply': {
          const text = renderTemplate(a.template, ctxT);
          const blocked = await messageGate();
          if (blocked) {
            add(step.id, a.type, 'BLOCKED', blocked);
            throw new Stop('BLOCKED', blocked);
          }
          const topics = sensitiveTopics(ev.text);
          if (a.type === 'draft_reply') {
            if (sim || !thread) {
              add(step.id, a.type, 'WOULD', `Save draft: "${text.slice(0, 120)}"`);
              break;
            }
            const d = await createOutboundDraft(db, {
              orgId: wf.orgId,
              thread,
              kind: ev.kind === 'COMMENT' ? 'COMMENT_REPLY' : 'DM',
              body: text,
              requestId: `draft:${wf.id}:${ev.eventKey}:${step.id}`,
              source: 'WORKFLOW',
              executionId: opts.executionId,
            });
            outboundId = d.row.id;
            add(step.id, a.type, 'DONE', 'Draft saved. Nothing was sent.');
            break;
          }
          if (a.type === 'queue_approval') {
            await queueForApproval(
              step.id,
              text,
              a.reason ?? (topics.length ? `sensitive: ${topics.join(', ')}` : 'approval step'),
            );
            throw new Stop('AWAITING_APPROVAL', 'awaiting approval');
          }
          // ---- send_reply: Fully Automatic, every guard must hold
          if (mode !== 'AUTOMATIC') {
            add(step.id, a.type, 'BLOCKED', 'Workflow is not in Fully Automatic mode.');
            throw new Stop('BLOCKED', 'not automatic mode');
          }
          if (await sendingPaused(db, wf.orgId)) {
            add(step.id, a.type, 'BLOCKED', 'Pause All Automatic Sending is on.');
            throw new Stop('BLOCKED', 'global pause');
          }
          if (!settings.autoSendEnabled) {
            add(
              step.id,
              a.type,
              'DOWNGRADED',
              'Automatic sending is not enabled for this account: sent to the approval queue instead.',
            );
            await queueForApproval(step.id, text, 'account automatic sending is off');
            throw new Stop('AWAITING_APPROVAL', 'awaiting approval');
          }
          if (topics.length) {
            add(
              step.id,
              a.type,
              'DOWNGRADED',
              `Sensitive topic (${topics.join(', ')}): a human must answer.`,
            );
            await queueForApproval(step.id, text, `sensitive: ${topics.join(', ')}`);
            throw new Stop('AWAITING_APPROVAL', 'awaiting approval');
          }
          if (thread && settings.perContactCooldownHours > 0) {
            const [{ n }] = rowsOf<{ n: number }>(
              await db.execute(
                sql`select count(*)::int as n from social_outbound_messages where thread_id = ${thread.id} and source = 'WORKFLOW' and state in ('SENT','UNCERTAIN','SENDING') and created_at > now() - make_interval(hours => ${settings.perContactCooldownHours})`,
              ),
            );
            if (n > 0) {
              add(
                step.id,
                a.type,
                'BLOCKED',
                `Already answered automatically within ${settings.perContactCooldownHours}h (cooldown).`,
              );
              throw new Stop('BLOCKED', 'cooldown');
            }
          }
          const [{ sent }] = rowsOf<{ sent: number }>(
            await db.execute(
              sql`select count(*)::int as sent from social_outbound_messages where connection_id = ${conn.id} and source = 'WORKFLOW' and state in ('SENT','UNCERTAIN') and created_at > now() - interval '24 hours'`,
            ),
          );
          if (sent >= settings.dailySendCap) {
            add(step.id, a.type, 'BLOCKED', `Daily automatic send cap reached (${settings.dailySendCap}).`);
            throw new Stop('BLOCKED', 'daily cap');
          }
          if (sim || !thread) {
            add(
              step.id,
              a.type,
              'WOULD',
              `Send as ${username ? '@' + username : conn.principalHint} to ${ev.senderName ?? ev.senderId}: "${text.slice(0, 120)}"`,
            );
            break;
          }
          // deterministic request id per (account, inbound message): two workflows can never both answer the same message
          const d = await createOutboundDraft(db, {
            orgId: wf.orgId,
            thread,
            kind: ev.kind === 'COMMENT' ? 'COMMENT_REPLY' : 'DM',
            body: text,
            requestId: `auto:${conn.id}:${ev.eventKey.split(':').slice(1).join(':')}`,
            source: 'WORKFLOW',
            executionId: opts.executionId,
          });
          if (!d.created) {
            add(
              step.id,
              a.type,
              'BLOCKED',
              'This message already has an automatic reply (duplicate prevented).',
            );
            throw new Stop('BLOCKED', 'duplicate prevented');
          }
          outboundId = d.row.id;
          const res = await sendOutbound(db, env, d.row.id, opts.overrides);
          add(
            step.id,
            a.type,
            res.state === 'SENT' ? 'DONE' : 'ERROR',
            res.state === 'SENT' ? 'Sent' : `${res.state}: ${res.error}`,
          );
          if (res.state === 'UNCERTAIN')
            throw new Stop('FAILED', 'delivery uncertain: not retried automatically');
          if (res.state !== 'SENT') throw new Stop('FAILED', res.error ?? 'send failed');
          break;
        }
      }
    }
  } catch (e) {
    if (e instanceof Stop) {
      status = e.status;
      outcome = e.outcome;
    } else throw e;
  }
  return { status, outcome, trace, approvalId, outboundId };
}

// ------------------------------------------------------------------ simulation

export async function simulateWorkflow(
  ctx: Ctx,
  id: string,
  input: {
    threadId?: string;
    connectionId?: string;
    text?: string;
    senderId?: string;
    senderName?: string;
    kind?: 'DM' | 'COMMENT';
    hasMedia?: boolean;
    isNewConversation?: boolean;
    at?: Date;
  },
) {
  const wf = await loadWorkflow(ctx.db, ctx.orgId, id);
  const ver = (await versionRow(ctx.db, id, wf.latestVersion))!;
  let ev: EngineEvent;
  let synthetic = true;
  if (input.threadId) {
    const [t] = await ctx.db
      .select()
      .from(conversationThreads)
      .where(and(eq(conversationThreads.id, input.threadId), eq(conversationThreads.orgId, ctx.orgId)));
    if (!t || !t.providerConnectionId) throw notFound('Conversation');
    const [m] = await ctx.db
      .select()
      .from(messages)
      .where(and(eq(messages.threadId, t.id), eq(messages.direction, 'INBOUND')))
      .orderBy(desc(messages.receivedAt))
      .limit(1);
    if (!m) throw badRequest('That conversation has no incoming message to simulate.');
    const { decrypt } = await import('./crypto');
    synthetic = false;
    ev = {
      eventKey: `sim:${m.id}`,
      connectionId: t.providerConnectionId,
      threadId: t.id,
      messageId: m.id,
      kind: t.kind === 'COMMENT' ? 'COMMENT' : 'DM',
      text: m.bodyEnc ? decrypt(m.bodyEnc, ctx.env.encryptionKey) : (m.bodyPreview ?? ''),
      senderId: t.participantId ?? 'unknown',
      senderName: t.participantName,
      hasMedia: m.attachmentRefs.length > 0,
      isNewConversation: false,
      receivedAt: m.receivedAt,
      isLive: true,
    };
  } else {
    const connectionId = input.connectionId ?? wf.connectionIds[0];
    if (!connectionId) throw badRequest('Choose an account for the simulation.');
    ev = {
      eventKey: `sim:${Date.now()}`,
      connectionId,
      threadId: null,
      messageId: null,
      kind: input.kind ?? 'DM',
      text: input.text ?? '',
      senderId: input.senderId ?? 'synthetic-sender',
      senderName: input.senderName ?? null,
      hasMedia: input.hasMedia ?? false,
      isNewConversation: input.isNewConversation ?? true,
      receivedAt: input.at ?? new Date(),
      isLive: true,
    };
  }
  const run = await executeWorkflow(ctx.db, ctx.env, wf, ver, ev, { simulate: true });
  const [exec] = await ctx.db
    .insert(workflowExecutions)
    .values({
      orgId: ctx.orgId,
      workflowId: wf.id,
      versionId: ver.id,
      versionNumber: ver.version,
      eventKey: ev.eventKey,
      isSimulation: true,
      connectionId: ev.connectionId,
      threadId: ev.threadId,
      status: run.status,
      outcome: `SIMULATION: ${run.outcome}`,
      trace: run.trace as any,
      finishedAt: new Date(),
    })
    .returning({ id: workflowExecutions.id });
  // A clean dry run (no errors) of this exact version unlocks Fully Automatic mode.
  const clean = !run.trace.some((t) => t.result === 'ERROR') && run.status !== 'FAILED';
  if (clean)
    await ctx.db
      .update(workflows)
      .set({ testedAt: new Date(), testedVersion: ver.version })
      .where(eq(workflows.id, wf.id));
  return { executionId: exec!.id, simulated: true, synthetic, ...run, testRecorded: clean };
}

// ------------------------------------------------------------------ live runs

const pauseAfterFailures = 3;

/** Runs every active workflow scoped to the receiving account, once per provider event. Never called from an HTTP handler. */
export async function runWorkflowsForEvent(
  db: Db,
  env: ServiceEnv,
  orgId: string,
  ev: EngineEvent,
  overrides: Partial<ConnectorContext> = {},
) {
  const wfs = await db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.orgId, orgId),
        eq(workflows.status, 'ACTIVE'),
        isNull(workflows.deletedAt),
        sql`${ev.connectionId}::uuid = any(${workflows.connectionIds})`,
        sql`${workflows.activeVersionId} is not null`,
      ),
    );
  const results: { workflowId: string; executionId: string | null; status: string }[] = [];
  for (const wf of wfs) {
    const [ver] = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, wf.activeVersionId!));
    if (!ver) continue;
    const [exec] = await db
      .insert(workflowExecutions)
      .values({
        orgId,
        workflowId: wf.id,
        versionId: ver.id, // pinned: later edits never change a run in flight
        versionNumber: ver.version,
        eventKey: ev.eventKey,
        connectionId: ev.connectionId,
        threadId: ev.threadId,
        messageId: ev.messageId,
        status: 'RUNNING',
      })
      .onConflictDoNothing()
      .returning({ id: workflowExecutions.id });
    if (!exec) {
      results.push({ workflowId: wf.id, executionId: null, status: 'DUPLICATE' });
      continue;
    }
    try {
      const run = await executeWorkflow(db, env, wf, ver, ev, {
        simulate: false,
        executionId: exec.id,
        overrides,
      });
      await db
        .update(workflowExecutions)
        .set({
          status: run.status,
          outcome: run.outcome,
          trace: run.trace as any,
          finishedAt: run.status === 'AWAITING_APPROVAL' ? null : new Date(),
        })
        .where(eq(workflowExecutions.id, exec.id));
      if (run.status === 'FAILED') await recordFailure(db, wf, run.outcome);
      else if (run.status === 'COMPLETED')
        await db.update(workflows).set({ consecutiveFailures: 0 }).where(eq(workflows.id, wf.id));
      results.push({ workflowId: wf.id, executionId: exec.id, status: run.status });
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 300);
      await db
        .update(workflowExecutions)
        .set({ status: 'FAILED', error: msg, finishedAt: new Date() })
        .where(eq(workflowExecutions.id, exec.id));
      await recordFailure(db, wf, msg);
      results.push({ workflowId: wf.id, executionId: exec.id, status: 'FAILED' });
    }
  }
  return results;
}

async function recordFailure(db: Db, wf: Workflow, reason: string) {
  const [u] = await db
    .update(workflows)
    .set({ consecutiveFailures: sql`consecutive_failures + 1` })
    .where(eq(workflows.id, wf.id))
    .returning({ n: workflows.consecutiveFailures });
  if ((u?.n ?? 0) >= pauseAfterFailures) {
    await db
      .update(workflows)
      .set({
        status: 'PAUSED',
        pauseReason: `Paused automatically after ${pauseAfterFailures} failures in a row. Last: ${reason}`,
      })
      .where(eq(workflows.id, wf.id));
    await notify(db, {
      orgId: wf.orgId,
      type: 'workflow.paused',
      dedupeKey: `wf-paused:${wf.id}:${u!.n}`,
      title: `Workflow paused: ${wf.name}`,
      body: reason.slice(0, 200),
      severity: 'WARNING',
      deepLink: `/workflows/${wf.id}`,
    });
  }
}

/** Stores a message and, when it is a genuine new incoming one, runs the matching workflows. */
export async function processSocialEvent(
  db: Db,
  env: ServiceEnv,
  orgId: string,
  ev: SocialEvent,
  overrides: Partial<ConnectorContext> = {},
) {
  const sys = systemCtx({ db, env }, orgId);
  const r = await ingestSocialEvent(sys, ev);
  // outgoing messages (our own replies, echoes) and redeliveries never trigger anything: this is the loop guard
  if (r.duplicate || ev.direction !== 'INBOUND' || !r.messageId) return { ...r, runs: [] as any[] };
  if (ev.isLive)
    await notify(db, {
      orgId,
      type: 'SOCIAL_MESSAGE',
      dedupeKey: `social-msg:${ev.connectionId}:${ev.providerMsgId}`,
      title: `${ev.kind === 'COMMENT' ? 'New comment' : 'New message'} from ${ev.participantName ?? ev.participantId}`,
      body: ev.text.slice(0, 120),
      severity: 'INFO',
      deepLink: `/socials/inbox?thread=${r.threadId}`,
      sourceType: 'social_thread',
      sourceId: r.threadId,
    }).catch(() => false);
  const [cls] = await db
    .select()
    .from(inboundClassifications)
    .where(eq(inboundClassifications.messageId, r.messageId))
    .limit(1);
  const runs = await runWorkflowsForEvent(
    db,
    env,
    orgId,
    {
      eventKey: `${ev.connectionId}:${ev.providerMsgId}`,
      connectionId: ev.connectionId,
      threadId: r.threadId,
      messageId: r.messageId,
      kind: ev.kind,
      text: ev.text,
      senderId: ev.participantId,
      senderName: ev.participantName ?? null,
      hasMedia: ev.hasMedia ?? false,
      isNewConversation: r.isNewConversation,
      receivedAt: ev.receivedAt,
      isLive: ev.isLive,
      category: cls?.category,
      confidence: cls?.confidence,
    },
    overrides,
  );
  return { ...r, runs };
}

const LIVE_WINDOW_MS = 15 * 60_000;

/** Worker job: turns verified webhook rows into messages and workflow runs. Safe to re-run (everything is idempotent). */
export async function processMetaWebhookEvents(
  db: Db,
  env: ServiceEnv,
  overrides: Partial<ConnectorContext> = {},
  limit = 50,
) {
  const claimed = rowsOf<{ id: string; payload: any }>(
    await db.execute(sql`
      update provider_webhook_events set status = 'PROCESSING', processed_at = now()
      where id in (
        select id from provider_webhook_events
        where provider = 'instagram' and (status = 'PENDING' or (status = 'PROCESSING' and processed_at < now() - interval '5 minutes'))
        order by received_at limit ${limit} for update skip locked)
      returning id, payload`),
  );
  const out = { processed: 0, ignored: 0, failed: 0 };
  for (const row of claimed) {
    try {
      const events = parseInstagramWebhookEntry(row.payload?.entry);
      let handled = 0;
      for (const e of events) {
        const conns = await db
          .select()
          .from(providerConnections)
          .where(
            and(
              eq(providerConnections.provider, 'instagram'),
              eq(providerConnections.principalHint, e.accountId),
              sql`${providerConnections.encryptedTokenRef} is not null`,
            ),
          );
        for (const conn of conns) {
          await processSocialEvent(
            db,
            env,
            conn.orgId,
            {
              connectionId: conn.id,
              kind: e.kind,
              providerThreadId: e.providerThreadId,
              providerMsgId: e.providerMsgId,
              participantId: e.participantId,
              participantName: e.participantName,
              direction: e.direction,
              text: e.text,
              hasMedia: e.hasMedia,
              mediaId: e.mediaId,
              receivedAt: e.receivedAt,
              isLive: Date.now() - e.receivedAt.getTime() < LIVE_WINDOW_MS,
            },
            overrides,
          );
          handled += 1;
        }
      }
      await db
        .update(providerWebhookEvents)
        .set({
          status: handled ? 'PROCESSED' : 'IGNORED',
          error: handled
            ? null
            : events.length
              ? 'no connected account for this event'
              : 'no supported message or comment in this event',
        })
        .where(eq(providerWebhookEvents.id, row.id));
      if (handled) out.processed += 1;
      else out.ignored += 1;
    } catch (e) {
      out.failed += 1;
      await db
        .update(providerWebhookEvents)
        .set({ status: 'FAILED', error: String((e as Error).message).slice(0, 300) })
        .where(eq(providerWebhookEvents.id, row.id));
    }
  }
  return out;
}

// ------------------------------------------------------------------ executions + approvals

export async function listExecutions(
  ctx: Ctx,
  q: { workflowId?: string; status?: string; limit?: number } = {},
) {
  const where = [sql`e.org_id = ${ctx.orgId}`];
  if (q.workflowId) where.push(sql`e.workflow_id = ${q.workflowId}::uuid`);
  if (q.status) where.push(sql`e.status = ${q.status}`);
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select e.id, e.workflow_id as "workflowId", w.name as "workflowName", e.version_number as "version", e.status, e.outcome, e.is_simulation as "isSimulation",
             e.thread_id as "threadId", e.connection_id as "connectionId", e.started_at as "startedAt", e.finished_at as "finishedAt", e.error
      from workflow_executions e join workflows w on w.id = e.workflow_id
      where ${sql.join(where, sql` and `)} order by e.started_at desc limit ${Math.min(q.limit ?? 100, 300)}`),
  );
}

export async function getExecution(ctx: Ctx, id: string) {
  const [e] = await ctx.db
    .select()
    .from(workflowExecutions)
    .where(and(eq(workflowExecutions.id, id), eq(workflowExecutions.orgId, ctx.orgId)));
  if (!e) throw notFound('Execution');
  return e;
}

export async function listApprovals(ctx: Ctx, state?: string) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select a.id, a.state, a.proposed_text as "proposedText", a.final_text as "finalText", a.reason, a.created_at as "createdAt", a.kind,
             a.thread_id as "threadId", a.connection_id as "connectionId", a.recipient_id as "recipientId", a.last_error as "lastError",
             w.name as "workflowName", c.label as "accountLabel", c.config->>'username' as "accountUsername",
             t.participant_name as "participantName", t.last_inbound_at as "lastInboundAt", t.kind as "threadKind",
             (select m.body_preview from messages m where m.thread_id = t.id and m.direction = 'INBOUND' order by m.received_at desc limit 1) as "originalMessage"
      from workflow_approvals a
      join workflows w on w.id = a.workflow_id
      join conversation_threads t on t.id = a.thread_id
      join provider_connections c on c.id = a.connection_id
      where a.org_id = ${ctx.orgId} and ${state ? sql`a.state = ${state}` : sql`a.state in ('PENDING','SNOOZED')`}
      order by a.created_at asc limit 200`),
  );
}

/**
 * Human approval. The sender is fixed by the conversation, and every send guard is re-checked now: the window may have closed,
 * the token may have been revoked, or you may already have answered by hand since the proposal was made.
 */
export async function approveApproval(
  ctx: Ctx,
  id: string,
  input: { finalText?: string },
  overrides: Partial<ConnectorContext> = {},
) {
  const [a] = await ctx.db
    .select()
    .from(workflowApprovals)
    .where(and(eq(workflowApprovals.id, id), eq(workflowApprovals.orgId, ctx.orgId)));
  if (!a) throw notFound('Approval');
  if (a.state === 'SENT') return a; // idempotent
  if (!['PENDING', 'SNOOZED', 'FAILED'].includes(a.state))
    throw conflict(`This approval is already ${a.state}.`, undefined, 'APPROVAL_CLOSED');
  const text = (input.finalText ?? a.proposedText).trim();
  if (!text || text.length > 1000) throw badRequest('Reply must be 1-1000 characters.');
  const [thread] = await ctx.db
    .select()
    .from(conversationThreads)
    .where(eq(conversationThreads.id, a.threadId));
  if (!thread) throw notFound('Conversation');
  if (thread.providerConnectionId !== a.connectionId)
    throw new AppError(
      409,
      'IDENTITY_MISMATCH',
      'The conversation no longer belongs to the account this reply was prepared for.',
    );
  if (thread.lastOutboundAt && thread.lastOutboundAt > a.createdAt) {
    await ctx.db
      .update(workflowApprovals)
      .set({
        state: 'EXPIRED',
        lastError: 'You already replied manually.',
        decidedBy: ctx.userId,
        decidedAt: new Date(),
      })
      .where(eq(workflowApprovals.id, id));
    throw conflict(
      'You already replied to this conversation, so this approval was closed without sending.',
      undefined,
      'ALREADY_ANSWERED',
    );
  }
  const { row } = await createOutboundDraft(ctx.db, {
    orgId: ctx.orgId,
    thread,
    kind: a.kind as any,
    body: text,
    requestId: `approval:${id}`,
    source: 'APPROVAL',
    createdBy: ctx.userId,
    executionId: a.executionId,
  });
  const res = await sendOutbound(ctx.db, ctx.env, row.id, overrides);
  const state = res.state === 'SENT' ? 'SENT' : 'FAILED';
  await ctx.db
    .update(workflowApprovals)
    .set({
      state,
      finalText: text,
      decidedBy: ctx.userId,
      decidedAt: new Date(),
      outboundId: row.id,
      lastError: res.state === 'SENT' ? null : res.error,
    })
    .where(eq(workflowApprovals.id, id));
  await ctx.db
    .update(workflowExecutions)
    .set({
      status: res.state === 'SENT' ? 'COMPLETED' : 'FAILED',
      outcome: res.state === 'SENT' ? 'approved and sent' : `approved but ${res.state}`,
      finishedAt: new Date(),
    })
    .where(eq(workflowExecutions.id, a.executionId));
  await audit(ctx, 'workflow.approval.approve', { type: 'workflow_approval', id }, undefined, {
    state: res.state,
    connectionId: a.connectionId,
    recipientId: a.recipientId,
  });
  return { ...res, approvalState: state };
}

export async function rejectApproval(ctx: Ctx, id: string) {
  const [a] = await ctx.db
    .select()
    .from(workflowApprovals)
    .where(and(eq(workflowApprovals.id, id), eq(workflowApprovals.orgId, ctx.orgId)));
  if (!a) throw notFound('Approval');
  if (!['PENDING', 'SNOOZED'].includes(a.state))
    throw conflict(`This approval is already ${a.state}.`, undefined, 'APPROVAL_CLOSED');
  await ctx.db
    .update(workflowApprovals)
    .set({ state: 'REJECTED', decidedBy: ctx.userId, decidedAt: new Date() })
    .where(eq(workflowApprovals.id, id));
  await ctx.db
    .update(workflowExecutions)
    .set({ status: 'CANCELLED', outcome: 'rejected', finishedAt: new Date() })
    .where(eq(workflowExecutions.id, a.executionId));
  await audit(ctx, 'workflow.approval.reject', { type: 'workflow_approval', id });
  return { state: 'REJECTED' };
}

export async function snoozeApproval(ctx: Ctx, id: string, hours: number) {
  if (!(hours > 0 && hours <= 168)) throw badRequest('Snooze must be 1-168 hours');
  const until = new Date(Date.now() + hours * 3_600_000);
  const r = await ctx.db
    .update(workflowApprovals)
    .set({ state: 'SNOOZED', snoozedUntil: until })
    .where(
      and(
        eq(workflowApprovals.id, id),
        eq(workflowApprovals.orgId, ctx.orgId),
        sql`${workflowApprovals.state} in ('PENDING','SNOOZED')`,
      ),
    )
    .returning({ id: workflowApprovals.id });
  if (!r.length) throw notFound('Approval');
  return { state: 'SNOOZED', until };
}

void socialOutboundMessages;
