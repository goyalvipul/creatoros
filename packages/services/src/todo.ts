import {
  and,
  eq,
  internalActions,
  providerConnections,
  sql,
  taskIntegrations,
  taskLinks,
  type Db,
} from '@creatoros/db';
import {
  ConnectorError,
  TodoConnector,
  type ConnectorContext,
  type RemoteTask,
  type TaskDraft,
} from '@creatoros/connectors';
import { audit, emit } from './audit';
import { sha256Hex } from './crypto';
import { connectorContext } from './integrations';
import { badRequest, conflict, notFound, type Ctx, type ServiceEnv } from './types';

const todo = new TodoConnector();
const MAX_ATTEMPTS = 8;

type Link = typeof taskLinks.$inferSelect;
type Action = typeof internalActions.$inferSelect;

export const externalRefFor = (actionId: string) => `creatoros:action:${actionId}`;

function localHash(a: Action): string {
  return sha256Hex(
    [a.title, a.description ?? '', a.dueAt?.toISOString() ?? '', a.priority, a.state].join('\u0000'),
  );
}

function draftFor(a: Action, tz?: string): TaskDraft {
  return {
    title: a.title,
    description:
      [a.description, a.reason, a.deepLink ? `Open in Creator OS: ${a.deepLink}` : null]
        .filter(Boolean)
        .join('\n\n') || null,
    dueAt: a.dueAt ? a.dueAt.toISOString() : null,
    timezone: tz,
    priority: a.priority,
    completed: a.state === 'DONE',
    externalRef: externalRefFor(a.id),
  };
}

const logEntry = (link: Link, event: string, detail?: string) =>
  [...(link.syncLog ?? []), { at: new Date().toISOString(), event, ...(detail ? { detail } : {}) }].slice(
    -50,
  );

async function loadIntegration(db: Db, orgId: string) {
  const [ti] = await db.select().from(taskIntegrations).where(eq(taskIntegrations.orgId, orgId));
  if (!ti?.providerConnectionId) return null;
  const [conn] = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.id, ti.providerConnectionId));
  return conn ? { ti, conn } : null;
}

export async function todoStatus(ctx: Ctx) {
  const integ = await loadIntegration(ctx.db, ctx.orgId);
  const counts = (await ctx.db.execute(
    sql`select sync_state as state, count(*)::int as n from task_links where org_id = ${ctx.orgId} group by 1`,
  )) as unknown as { rows: { state: string; n: number }[] };
  return {
    configured: Boolean(integ),
    enabled: integ?.ti.enabled ?? false,
    connectionState: integ?.conn.state ?? 'NOT_CONFIGURED',
    lastReconcileAt: integ?.ti.lastReconcileAt ?? null,
    lastError: integ?.ti.lastError ?? null,
    links: Object.fromEntries(counts.rows.map((r) => [r.state, r.n])),
  };
}

/** Owner chooses to send an internal action to the Todo app (create) or attach an existing remote task (link). */
export async function linkActionToTodo(ctx: Ctx, actionId: string, opts: { remoteTaskId?: string } = {}) {
  const [a] = await ctx.db
    .select()
    .from(internalActions)
    .where(and(eq(internalActions.id, actionId), eq(internalActions.orgId, ctx.orgId)));
  if (!a) throw notFound('Action');
  const integ = await loadIntegration(ctx.db, ctx.orgId);
  if (!integ || !integ.ti.enabled)
    throw badRequest(
      'The Todo integration is not configured or has not passed its connection test yet.',
      undefined,
      'TODO_NOT_READY',
    );
  const [existing] = await ctx.db
    .select()
    .from(taskLinks)
    .where(and(eq(taskLinks.actionId, actionId), eq(taskLinks.integrationId, integ.ti.id)));
  if (existing) return existing; // idempotent: one link per action
  const [link] = await ctx.db
    .insert(taskLinks)
    .values({
      orgId: ctx.orgId,
      actionId,
      integrationId: integ.ti.id,
      idempotencyKey: `creatoros:${ctx.orgId}:${actionId}`,
      remoteTaskId: opts.remoteTaskId ?? null,
      syncState: 'PENDING',
      nextAttemptAt: new Date(),
      syncLog: [{ at: new Date().toISOString(), event: 'link_requested' }],
    })
    .onConflictDoNothing()
    .returning();
  await audit(ctx, 'todo.link', { type: 'action', id: actionId }, undefined, {
    remoteTaskId: opts.remoteTaskId ?? null,
  });
  if (!link) {
    const [again] = await ctx.db
      .select()
      .from(taskLinks)
      .where(and(eq(taskLinks.actionId, actionId), eq(taskLinks.integrationId, integ.ti.id)));
    return again!;
  }
  return link;
}

/**
 * One reconciliation step for a link. Policy TODO_OWNS_DUE_AND_COMPLETION: the Todo app wins for due date and completion,
 * Creator OS wins for title/description/reason. Duplicate creation is prevented by Idempotency-Key + a findByRef pre-check.
 */
export async function syncTaskLink(
  db: Db,
  env: ServiceEnv,
  linkId: string,
  overrides: Partial<ConnectorContext> = {},
): Promise<Link> {
  const [link] = await db.select().from(taskLinks).where(eq(taskLinks.id, linkId));
  if (!link) throw notFound('Task link');
  const [a] = await db.select().from(internalActions).where(eq(internalActions.id, link.actionId));
  const integ = await loadIntegration(db, link.orgId);
  if (!a || !integ) throw notFound('Todo integration');
  const cctx = connectorContext(db, env, integ.conn, overrides);
  const tz = (await db.execute(
    sql`select timezone from organizations where id = ${link.orgId}`,
  )) as unknown as { rows: { timezone: string }[] };
  const zone = tz.rows[0]?.timezone;
  let remote: RemoteTask | null = null;
  let log = link.syncLog ?? [];
  try {
    if (!link.remoteTaskId) {
      remote = await todo.findByRef(cctx, externalRefFor(a.id));
      if (remote) log = logEntry(link, 'adopted_existing', remote.id);
      else {
        remote = await todo.createTask(cctx, draftFor(a, zone), link.idempotencyKey);
        log = logEntry(link, 'created', remote.id);
      }
    } else {
      remote = await todo.getTask(cctx, link.remoteTaskId);
      if (!remote) {
        await db
          .update(taskLinks)
          .set({
            syncState: 'CONFLICT',
            lastError: 'Remote task no longer exists',
            conflictData: { reason: 'remote_deleted' },
            syncLog: logEntry(link, 'remote_deleted'),
            updatedAt: new Date(),
          })
          .where(eq(taskLinks.id, linkId));
        return (await db.select().from(taskLinks).where(eq(taskLinks.id, linkId)))[0]!;
      }
      const hash = localHash(a);
      const localChanged = hash !== link.lastLocalHash;
      const remoteChanged = remote.revision !== link.remoteRevision;
      // pull: Todo owns due date + completion
      let current = a;
      if (remoteChanged) {
        const patch: Partial<typeof internalActions.$inferInsert> = {};
        if (remote.completed && a.state === 'OPEN') {
          patch.state = 'DONE';
          patch.completedAt = remote.completedAt ? new Date(remote.completedAt) : new Date();
          patch.completionEvidence = 'Completed in the Todo app';
        } else if (!remote.completed && a.state === 'DONE' && !localChanged) {
          patch.state = 'OPEN';
          patch.completedAt = null;
        }
        const rDue = remote.dueAt ? new Date(remote.dueAt) : null;
        if ((rDue?.getTime() ?? null) !== (a.dueAt?.getTime() ?? null)) patch.dueAt = rDue;
        if (Object.keys(patch).length) {
          const [upd] = await db
            .update(internalActions)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(internalActions.id, a.id))
            .returning();
          current = upd!;
          if (patch.state === 'DONE')
            await emit(db, link.orgId, 'action.completed', { actionId: a.id, via: 'todo' });
          log = logEntry({ ...link, syncLog: log }, 'pulled', Object.keys(patch).join(','));
        }
      }
      // push: our fields (title/description/priority) and, when only we changed, completion
      if (localChanged && !(remoteChanged && remote.completed !== (a.state === 'DONE') && remote.completed)) {
        const draft = draftFor(current, zone);
        const patch: Partial<TaskDraft> = {
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
        };
        if (!remoteChanged) {
          patch.dueAt = draft.dueAt;
          patch.completed = draft.completed;
        }
        try {
          remote = await todo.updateTask(cctx, link.remoteTaskId, patch, remote.revision);
          log = logEntry({ ...link, syncLog: log }, 'pushed', Object.keys(patch).join(','));
        } catch (e) {
          if (e instanceof ConnectorError && e.kind === 'CONFLICT') {
            await db
              .update(taskLinks)
              .set({
                syncState: 'CONFLICT',
                conflictData: { local: patch, remoteRevision: remote.revision },
                lastError: 'Remote changed while syncing (If-Match failed)',
                syncLog: logEntry({ ...link, syncLog: log }, 'conflict'),
                updatedAt: new Date(),
              })
              .where(eq(taskLinks.id, linkId));
            return (await db.select().from(taskLinks).where(eq(taskLinks.id, linkId)))[0]!;
          }
          throw e;
        }
      }
      a.title = current.title;
    }
    const [fresh] = await db.select().from(internalActions).where(eq(internalActions.id, a.id));
    const [saved] = await db
      .update(taskLinks)
      .set({
        remoteTaskId: remote!.id,
        remoteRevision: remote!.revision,
        syncState: 'SYNCED',
        attempts: 0,
        nextAttemptAt: null,
        lastSyncAt: new Date(),
        lastError: null,
        lastLocalHash: localHash(fresh!),
        remoteDueAt: remote!.dueAt ? new Date(remote!.dueAt) : null,
        remoteCompletedAt: remote!.completedAt ? new Date(remote!.completedAt) : null,
        conflictData: {},
        syncLog: log,
        updatedAt: new Date(),
      })
      .where(eq(taskLinks.id, linkId))
      .returning();
    return saved!;
  } catch (e) {
    const err = e instanceof ConnectorError ? e : new ConnectorError('SERVER', (e as Error).message);
    const attempts = link.attempts + 1;
    const dead = !err.retryable || attempts >= MAX_ATTEMPTS;
    const backoff = Math.min(2 ** attempts * 60_000, 6 * 3_600_000);
    const [saved] = await db
      .update(taskLinks)
      .set({
        attempts,
        syncState: dead ? (err.retryable ? 'DEAD_LETTER' : 'FAILED') : 'PENDING',
        nextAttemptAt: dead ? null : new Date(Date.now() + (err.retryAfterMs ?? backoff)),
        lastError: err.message,
        syncLog: logEntry(link, 'error', `${err.kind}: ${err.message}`),
        updatedAt: new Date(),
      })
      .where(eq(taskLinks.id, linkId))
      .returning();
    await db
      .update(taskIntegrations)
      .set({ lastError: err.message })
      .where(eq(taskIntegrations.id, link.integrationId));
    return saved!;
  }
}

/** Worker: process pending links that are due, then reconcile recently synced ones (pull completion/due changes). */
export async function syncDueTaskLinks(
  db: Db,
  env: ServiceEnv,
  opts: {
    now?: Date;
    reconcileAfterMinutes?: number;
    limit?: number;
    overrides?: Partial<ConnectorContext>;
  } = {},
) {
  const now = opts.now ?? new Date();
  const due = (await db.execute(
    sql`select id from task_links where sync_state = 'PENDING' and (next_attempt_at is null or next_attempt_at <= ${now.toISOString()}::timestamptz) order by created_at limit ${opts.limit ?? 50}`,
  )) as unknown as { rows: { id: string }[] };
  const stale = (await db.execute(
    sql`select id from task_links where sync_state = 'SYNCED' and (last_sync_at is null or last_sync_at <= ${new Date(now.getTime() - (opts.reconcileAfterMinutes ?? 5) * 60_000).toISOString()}::timestamptz) order by last_sync_at nulls first limit ${opts.limit ?? 50}`,
  )) as unknown as { rows: { id: string }[] };
  let ok = 0;
  let failed = 0;
  for (const r of [...due.rows, ...stale.rows]) {
    const l = await syncTaskLink(db, env, r.id, opts.overrides);
    if (l.syncState === 'SYNCED') ok += 1;
    else failed += 1;
  }
  await db.update(taskIntegrations).set({ lastReconcileAt: now });
  return { processed: due.rows.length + stale.rows.length, ok, failed };
}

/** Owner resolves a conflict explicitly: keep Creator OS values (force push) or take the Todo values. */
export async function resolveTodoConflict(
  ctx: Ctx,
  linkId: string,
  resolution: 'USE_LOCAL' | 'USE_REMOTE',
  overrides: Partial<ConnectorContext> = {},
) {
  const [link] = await ctx.db
    .select()
    .from(taskLinks)
    .where(and(eq(taskLinks.id, linkId), eq(taskLinks.orgId, ctx.orgId)));
  if (!link) throw notFound('Task link');
  if (link.syncState !== 'CONFLICT') throw conflict('This link has no conflict to resolve.');
  if (resolution === 'USE_REMOTE') {
    await ctx.db
      .update(taskLinks)
      .set({
        syncState: 'PENDING',
        remoteRevision: null,
        lastLocalHash: null,
        conflictData: {},
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(taskLinks.id, linkId));
    // next sync pulls remote first (revision differs) and our unchanged-hash push is skipped
    await ctx.db.update(taskLinks).set({ lastLocalHash: null }).where(eq(taskLinks.id, linkId));
  } else {
    const integ = await loadIntegration(ctx.db, ctx.orgId);
    const [a] = await ctx.db.select().from(internalActions).where(eq(internalActions.id, link.actionId));
    if (!integ || !a || !link.remoteTaskId) throw badRequest('Cannot push: link is incomplete');
    const cctx = connectorContext(ctx.db, ctx.env, integ.conn, overrides);
    const remote = await todo.updateTask(cctx, link.remoteTaskId, draftFor(a), null);
    await ctx.db
      .update(taskLinks)
      .set({
        syncState: 'SYNCED',
        remoteRevision: remote.revision,
        lastLocalHash: localHash(a),
        conflictData: {},
        lastError: null,
        lastSyncAt: new Date(),
        syncLog: logEntry(link, 'resolved_use_local'),
        updatedAt: new Date(),
      })
      .where(eq(taskLinks.id, linkId));
  }
  await audit(ctx, 'todo.conflict.resolve', { type: 'task_link', id: linkId }, undefined, { resolution });
  return (await ctx.db.select().from(taskLinks).where(eq(taskLinks.id, linkId)))[0]!;
}

export async function retryTaskLink(ctx: Ctx, linkId: string) {
  const [l] = await ctx.db
    .update(taskLinks)
    .set({
      syncState: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(taskLinks.id, linkId), eq(taskLinks.orgId, ctx.orgId)))
    .returning();
  if (!l) throw notFound('Task link');
  return l;
}

export async function listTaskLinks(ctx: Ctx, state?: string) {
  const where = [sql`l.org_id = ${ctx.orgId}`];
  if (state) where.push(sql`l.sync_state = ${state}::sync_state`);
  return (
    (await ctx.db.execute(
      sql`select l.id, l.action_id as "actionId", a.title, l.remote_task_id as "remoteTaskId", l.sync_state as "syncState", l.attempts, l.last_error as "lastError", l.last_sync_at as "lastSyncAt", l.next_attempt_at as "nextAttemptAt", l.conflict_data as "conflictData", l.sync_log as "syncLog" from task_links l join internal_actions a on a.id = l.action_id where ${sql.join(where, sql` and `)} order by l.updated_at desc limit 200`,
    )) as unknown as { rows: any[] }
  ).rows;
}
