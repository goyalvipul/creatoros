import { and, eq, internalActions, providerConnections, taskIntegrations, taskLinks, webhookReceipts } from '@creatoros/db';
import {
  ConnectorError,
  createWorkspaceTask,
  listWorkspaceTasks,
  patchWorkspaceTask,
  verifyWorkspaceSignature,
  workspaceOrigin,
  type ConnectorContext,
  type WorkspaceTask,
} from '@creatoros/connectors';
import { audit } from './audit';
import { sha256Hex } from './crypto';
import { connectorContext, loadCredentials } from './integrations';
import { badRequest, type Ctx, type ServiceEnv } from './types';
import type { Db } from '@creatoros/db';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

type Action = typeof internalActions.$inferSelect;
type Link = typeof taskLinks.$inferSelect;

const snapshot = (a: Pick<Action, 'title' | 'description' | 'dueAt' | 'priority' | 'state'>) =>
  sha256Hex(
    [a.title, a.description ?? '', a.dueAt?.toISOString() ?? '', a.priority, a.state].join('\u0000'),
  );

function priorityIn(n: number | null): 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' {
  if (n === 1) return 'URGENT';
  if (n === 2) return 'HIGH';
  if (n === 4) return 'LOW';
  return 'NORMAL';
}

function priorityOut(p: string): number {
  if (p === 'URGENT') return 1;
  if (p === 'HIGH') return 2;
  if (p === 'LOW') return 4;
  return 3;
}

function statusOut(state: string): 'open' | 'completed' | 'archived' {
  if (state === 'DONE') return 'completed';
  if (state === 'DISMISSED') return 'archived';
  return 'open';
}

function dueOf(task: WorkspaceTask): Date | null {
  const raw = task.dueAtUtc || (task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function localState(task: WorkspaceTask): { state: 'OPEN' | 'DONE' | 'DISMISSED'; completedAt: Date | null; dismissedAt: Date | null } {
  if (task.deletedAt) return { state: 'DISMISSED', completedAt: null, dismissedAt: new Date(task.deletedAt) };
  if (task.status === 'completed')
    return { state: 'DONE', completedAt: task.completedAt ? new Date(task.completedAt) : new Date(), dismissedAt: null };
  if (task.status === 'archived') return { state: 'DISMISSED', completedAt: null, dismissedAt: new Date() };
  return { state: 'OPEN', completedAt: null, dismissedAt: null };
}

async function workspaceConnections(db: Db) {
  return db.select().from(providerConnections).where(eq(providerConnections.provider, 'todo'));
}

async function integrationFor(db: Db, orgId: string, connectionId: string) {
  const [ti] = await db.select().from(taskIntegrations).where(eq(taskIntegrations.orgId, orgId));
  if (ti) return ti;
  const [created] = await db
    .insert(taskIntegrations)
    .values({ orgId, providerConnectionId: connectionId, name: 'Workspace OS', enabled: true })
    .returning();
  return created!;
}

async function linkForTask(db: Db, orgId: string, taskId: string) {
  const [row] = await db
    .select({ link: taskLinks, action: internalActions })
    .from(taskLinks)
    .innerJoin(internalActions, eq(internalActions.id, taskLinks.actionId))
    .where(and(eq(taskLinks.orgId, orgId), eq(taskLinks.remoteTaskId, taskId)));
  return row ?? null;
}

/** Writes one published task onto Today. A lower version than the one we hold is ignored. */
export async function applyWorkspaceTask(db: Db, orgId: string, connectionId: string, task: WorkspaceTask) {
  const integ = await integrationFor(db, orgId, connectionId);
  const existing = await linkForTask(db, orgId, task.id);
  if (existing && Number.isFinite(task.version) && task.version < Number(existing.link.remoteRevision))
    return existing.action.id;
  if (
    existing &&
    task.version === Number(existing.link.remoteRevision) &&
    existing.link.lastLocalHash &&
    existing.link.lastLocalHash !== snapshot(existing.action)
  )
    return existing.action.id;

  const state = localState(task);
  const dueAt = dueOf(task);
  const values = {
    title: task.title || 'Untitled task',
    description: task.description,
    dueAt,
    priority: priorityIn(task.priority),
    state: state.state,
    completedAt: state.completedAt,
    dismissedAt: state.dismissedAt,
    reason: task.projectName ? `Workspace OS · ${task.projectName}` : 'Workspace OS',
    metadata: {
      wosTaskId: task.id,
      projectId: task.projectId,
      projectName: task.projectName,
      labels: task.labels,
      dueTimezone: task.dueTimezone,
    },
    updatedAt: new Date(),
  };

  let actionId = existing?.action.id;
  if (!actionId && task.externalId && /^[0-9a-f-]{36}$/i.test(task.externalId)) {
    const [byExternal] = await db
      .select({ id: internalActions.id })
      .from(internalActions)
      .where(and(eq(internalActions.id, task.externalId), eq(internalActions.orgId, orgId)));
    actionId = byExternal?.id;
  }
  if (actionId) {
    await db.update(internalActions).set(values).where(eq(internalActions.id, actionId));
  } else {
    const [created] = await db
      .insert(internalActions)
      .values({
        orgId,
        sourceType: 'workspace-os',
        dedupeKey: `wos:${task.id}`,
        ...values,
      })
      .returning({ id: internalActions.id });
    actionId = created!.id;
  }
  const [fresh] = await db.select().from(internalActions).where(eq(internalActions.id, actionId));
  const hash = snapshot(fresh!);
  const linkValues = {
    remoteTaskId: task.id,
    remoteRevision: String(task.version),
    syncState: 'SYNCED' as const,
    lastSyncAt: new Date(),
    lastError: null,
    lastLocalHash: hash,
    remoteDueAt: dueAt,
    remoteCompletedAt: state.completedAt,
    conflictData: {},
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(taskLinks).set(linkValues).where(eq(taskLinks.id, existing.link.id));
  } else {
    await db
      .insert(taskLinks)
      .values({
        orgId,
        actionId: actionId!,
        integrationId: integ.id,
        idempotencyKey: `wos:${orgId}:${task.id}`,
        syncLog: [{ at: new Date().toISOString(), event: 'received' }],
        ...linkValues,
      })
      .onConflictDoNothing();
  }
  return actionId!;
}

export async function removeWorkspaceTask(
  db: Db,
  orgId: string,
  connectionId: string,
  task: { id: string; version?: number },
  reason: string,
) {
  const existing = await linkForTask(db, orgId, task.id);
  if (!existing) return null;
  if (task.version != null && task.version < Number(existing.link.remoteRevision)) return existing.action.id;
  const [fresh] = await db
    .update(internalActions)
    .set({
      state: 'DISMISSED',
      dismissedAt: new Date(),
      reason: reason === 'deleted' ? 'Deleted in Workspace OS' : 'Unpublished in Workspace OS',
      updatedAt: new Date(),
    })
    .where(eq(internalActions.id, existing.action.id))
    .returning();
  await db
    .update(taskLinks)
    .set({
      remoteRevision: task.version != null ? String(task.version) : existing.link.remoteRevision,
      syncState: 'SYNCED',
      lastLocalHash: snapshot(fresh!),
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(taskLinks.id, existing.link.id));
  return existing.action.id;
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/**
 * Verifies the Workspace OS signature over the raw body, then applies ping / task.upsert / task.remove.
 * The reply is the raw JSON Workspace OS stores (`externalId`), not the usual API envelope.
 */
export async function receiveWorkspaceWebhook(
  db: Db,
  env: ServiceEnv,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  nowMs = Date.now(),
): Promise<{ status: number; body: Record<string, unknown> }> {
  const eventId = header(headers, 'x-wos-event-id');
  const timestamp = header(headers, 'x-wos-timestamp');
  const signature = header(headers, 'x-wos-signature');
  if (!eventId) return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Missing event id.' } } };

  const conns = await workspaceConnections(db);
  const matched = conns.find((c) => {
    const secret = loadCredentials(env, c).signingSecret;
    return Boolean(secret && verifyWorkspaceSignature(secret, timestamp, rawBody, signature, nowMs));
  });
  if (!matched)
    return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Signature was not accepted.' } } };
  if (matched.state === 'PAUSED' || matched.state === 'DISABLED')
    return { status: 503, body: { error: { code: 'PAUSED', message: 'Creator OS has this connection paused.' } } };

  let msg: any;
  try {
    msg = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'Body is not JSON.' } } };
  }

  const [seen] = await db
    .select({ id: webhookReceipts.id })
    .from(webhookReceipts)
    .where(and(eq(webhookReceipts.source, 'workspace-os'), eq(webhookReceipts.eventId, eventId)));
  if (seen) {
    const taskId = msg?.task?.id ? String(msg.task.id) : '';
    const existing = taskId ? await linkForTask(db, matched.orgId, taskId) : null;
    return { status: 200, body: existing ? { externalId: existing.action.id } : {} };
  }

  let externalId: string | null = null;
  if (msg?.type === 'ping') {
    externalId = null;
  } else if (msg?.type === 'task.upsert' && msg.task?.id) {
    externalId = await applyWorkspaceTask(db, matched.orgId, matched.id, {
      id: String(msg.task.id),
      externalId: msg.task.externalId ? String(msg.task.externalId) : null,
      title: String(msg.task.title ?? ''),
      description: msg.task.description ?? null,
      status: msg.task.status === 'completed' || msg.task.status === 'archived' ? msg.task.status : 'open',
      priority: msg.task.priority == null ? null : Number(msg.task.priority),
      completedAt: msg.task.completedAt ?? null,
      dueDate: msg.task.dueDate ?? null,
      dueAtUtc: msg.task.dueAtUtc ?? null,
      dueTimezone: msg.task.dueTimezone ?? null,
      projectId: msg.task.projectId ?? null,
      projectName: msg.task.projectName ?? null,
      labels: Array.isArray(msg.task.labels) ? msg.task.labels.map(String) : [],
      deletedAt: msg.task.deletedAt ?? null,
      version: Number(msg.task.version ?? 0),
      raw: msg.task,
    });
  } else if (msg?.type === 'task.remove' && msg.task?.id) {
    externalId = await removeWorkspaceTask(
      db,
      matched.orgId,
      matched.id,
      { id: String(msg.task.id), version: msg.task.version == null ? undefined : Number(msg.task.version) },
      String(msg.reason ?? 'unpublished'),
    );
  } else {
    return { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'Unknown event type.' } } };
  }

  await db.insert(webhookReceipts).values({ source: 'workspace-os', eventId }).onConflictDoNothing();
  await audit(
    { db, orgId: matched.orgId, userId: null, actor: { type: 'system' } },
    'todo.task.updated',
    { type: 'workspace_event', id: eventId },
    undefined,
    { type: msg?.type, externalId },
  );
  return { status: 200, body: externalId ? { externalId } : {} };
}

function dueFields(a: Action) {
  if (!a.dueAt) return { dueAtUtc: null, dueDate: null };
  const zone = (a.metadata as { dueTimezone?: string } | null)?.dueTimezone || 'America/Vancouver';
  const dueDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(a.dueAt);
  return { dueAtUtc: a.dueAt.toISOString(), dueDate, dueTimezone: zone };
}

function outbound(a: Action): Record<string, unknown> {
  return {
    externalId: a.id,
    title: a.title,
    description: a.description,
    priority: priorityOut(a.priority),
    status: statusOut(a.state),
    ...dueFields(a),
  };
}

async function remember(db: Db, link: Link, task: WorkspaceTask, action: Action) {
  const [fresh] = await db.select().from(internalActions).where(eq(internalActions.id, action.id));
  await db
    .update(taskLinks)
    .set({
      remoteTaskId: task.id,
      remoteRevision: String(task.version),
      syncState: 'SYNCED',
      attempts: 0,
      nextAttemptAt: null,
      lastSyncAt: new Date(),
      lastError: null,
      lastLocalHash: snapshot(fresh ?? action),
      conflictData: {},
      updatedAt: new Date(),
    })
    .where(eq(taskLinks.id, link.id));
}

/** Pushes a local edit of a Workspace OS task. Inbound webhooks are not pushed back. */
export async function syncWorkspaceLink(
  db: Db,
  env: ServiceEnv,
  linkId: string,
  overrides: Partial<ConnectorContext> = {},
): Promise<Link> {
  const [link] = await db.select().from(taskLinks).where(eq(taskLinks.id, linkId));
  if (!link) return (await db.select().from(taskLinks).where(eq(taskLinks.id, linkId)))[0]!;
  const [action] = await db.select().from(internalActions).where(eq(internalActions.id, link.actionId));
  const [todoConn] = await db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.orgId, link.orgId), eq(providerConnections.provider, 'todo')));
  if (!action || !todoConn) return link;
  const baseUrl = (todoConn.config as { baseUrl?: string } | null)?.baseUrl;
  if (!baseUrl) return link;
  if (link.remoteTaskId && snapshot(action) === link.lastLocalHash) return link;
  const ctx = connectorContext(db, env, todoConn, overrides);
  try {
    if (!link.remoteTaskId) {
      const created = await createWorkspaceTask(ctx, baseUrl, outbound(action));
      let task = created.task;
      if (!task) {
        let cursor: string | null = null;
        for (let i = 0; i < 20 && !task; i++) {
          const page = await listWorkspaceTasks(ctx, baseUrl, cursor);
          task = page.tasks.find((t) => t.externalId === action.id) ?? null;
          cursor = page.nextCursor;
          if (!cursor) break;
        }
      }
      if (!task) throw new ConnectorError('SERVER', 'Workspace OS accepted the task but did not return its id.');
      await remember(db, link, task, action);
    } else {
      const patch = outbound(action);
      if (link.remoteRevision && Number.isFinite(Number(link.remoteRevision))) patch.baseVersion = Number(link.remoteRevision);
      const task = await patchWorkspaceTask(ctx, baseUrl, link.remoteTaskId, patch);
      await remember(db, link, task, action);
    }
  } catch (e) {
    if (e instanceof ConnectorError && e.kind === 'CONFLICT') {
      const current = (e as ConnectorError & { current?: WorkspaceTask | null }).current ?? null;
      await db
        .update(taskLinks)
        .set({
          syncState: 'CONFLICT',
          conflictData: current ? { task: current } : { message: e.message },
          lastError: e.message,
          updatedAt: new Date(),
        })
        .where(eq(taskLinks.id, link.id));
    } else {
      const message = (e as Error).message;
      await db
        .update(taskLinks)
        .set({ syncState: 'PENDING', lastError: message, nextAttemptAt: new Date(Date.now() + 60_000), updatedAt: new Date() })
        .where(eq(taskLinks.id, link.id));
      await db.update(taskIntegrations).set({ lastError: message }).where(eq(taskIntegrations.orgId, link.orgId));
    }
  }
  return (await db.select().from(taskLinks).where(eq(taskLinks.id, linkId)))[0]!;
}

export async function resolveWorkspaceConflict(
  ctx: Ctx,
  link: Link,
  resolution: 'USE_LOCAL' | 'USE_REMOTE',
  overrides: Partial<ConnectorContext> = {},
) {
  const [todoConn] = await ctx.db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.orgId, ctx.orgId), eq(providerConnections.provider, 'todo')));
  const [action] = await ctx.db.select().from(internalActions).where(eq(internalActions.id, link.actionId));
  if (!todoConn || !action) throw badRequest('Workspace OS is not connected.');
  const baseUrl = (todoConn.config as { baseUrl?: string } | null)?.baseUrl;
  if (!baseUrl || !link.remoteTaskId) throw badRequest('This task has no Workspace OS id yet.');
  const cctx = connectorContext(ctx.db, ctx.env, todoConn, overrides);
  if (resolution === 'USE_REMOTE') {
    const task = (link.conflictData as { task?: WorkspaceTask } | null)?.task;
    if (!task?.id) throw badRequest('Workspace OS did not send the current task. Press Retry after Sync now.');
    await applyWorkspaceTask(ctx.db, ctx.orgId, todoConn.id, task);
    return;
  }
  const task = await patchWorkspaceTask(cctx, baseUrl, link.remoteTaskId, outbound(action));
  await remember(ctx.db, link, task, action);
}

/** Pulls published tasks in case a webhook was missed. Does not echo those tasks back. */
export async function reconcileWorkspaceTasks(
  db: Db,
  env: ServiceEnv,
  overrides: Partial<ConnectorContext> = {},
) {
  const conns = await workspaceConnections(db);
  let applied = 0;
  for (const conn of conns) {
    const cfg = conn.config as { mode?: string; baseUrl?: string } | null;
    if (cfg?.mode !== 'workspace-os' || !cfg.baseUrl) continue;
    if (conn.state === 'PAUSED' || conn.state === 'DISABLED' || conn.state === 'NOT_CONFIGURED') continue;
    const ctx = connectorContext(db, env, conn, overrides);
    try {
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const listed = await listWorkspaceTasks(ctx, cfg.baseUrl, cursor);
        for (const task of listed.tasks) {
          if (task.deletedAt) await removeWorkspaceTask(db, conn.orgId, conn.id, task, 'deleted');
          else await applyWorkspaceTask(db, conn.orgId, conn.id, task);
          applied += 1;
        }
        cursor = listed.nextCursor;
        if (!cursor) break;
      }
      await db.update(taskIntegrations).set({ lastError: null, lastReconcileAt: new Date() }).where(eq(taskIntegrations.orgId, conn.orgId));
    } catch (e) {
      await db
        .update(taskIntegrations)
        .set({ lastError: (e as Error).message })
        .where(eq(taskIntegrations.orgId, conn.orgId));
    }
  }
  return { applied };
}

export function assertWorkspaceBaseUrl(raw: string): string {
  try {
    return workspaceOrigin(raw);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
}
