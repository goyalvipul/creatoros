import {
  and,
  eq,
  notificationPreferences,
  notifications,
  outboxEvents,
  sql,
  storageRoots,
  type Db,
} from '@creatoros/db';
import { inQuietHours, type EventType } from '@creatoros/domain';
import { badRequest, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

export interface NotifyInput {
  orgId: string;
  userId?: string | null;
  type: string;
  dedupeKey?: string | null;
  title: string;
  body?: string | null;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  deepLink?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}

/** When do quiet hours end? Used to hold non-critical notifications back instead of dropping them. */
export function quietHoursEnd(now: Date, tz: string, start: string | null, end: string | null): Date | null {
  if (!inQuietHours(now, tz, start, end)) return null;
  let t = now.getTime();
  for (let i = 0; i < 24 * 4 + 1; i++) {
    t += 15 * 60_000;
    if (!inQuietHours(new Date(t), tz, start, end)) return new Date(t);
  }
  return null;
}

export async function notify(db: Db, input: NotifyInput, now = new Date()): Promise<boolean> {
  let snoozedUntil: Date | null = null;
  if (input.severity !== 'CRITICAL') {
    const [pref] = await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.orgId, input.orgId), input.userId ? eq(notificationPreferences.userId, input.userId) : sql`true`)).limit(1);
    if (pref) snoozedUntil = quietHoursEnd(now, pref.timezone, pref.quietStart, pref.quietEnd);
  }
  const rows = await db
    .insert(notifications)
    .values({ orgId: input.orgId, userId: input.userId ?? null, type: input.type, dedupeKey: input.dedupeKey ?? null, title: input.title, body: input.body ?? null, severity: input.severity ?? 'INFO', deepLink: input.deepLink ?? null, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, snoozedUntil, deliveredAt: now, deliveredVia: ['in_app'] })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function listNotifications(ctx: Ctx, q: { unreadOnly?: boolean; limit?: number } = {}) {
  const where = [sql`org_id = ${ctx.orgId}`, sql`(user_id is null or user_id = ${ctx.userId})`, sql`(snoozed_until is null or snoozed_until <= now())`];
  if (q.unreadOnly) where.push(sql`read_at is null`);
  return rowsOf<any>(await ctx.db.execute(sql`select id, type, title, body, severity, deep_link as "deepLink", read_at as "readAt", created_at as "createdAt" from notifications where ${sql.join(where, sql` and `)} order by created_at desc limit ${Math.min(q.limit ?? 50, 200)}`));
}

export async function unreadCount(ctx: Ctx) {
  return rowsOf<{ n: number }>(await ctx.db.execute(sql`select count(*)::int as n from notifications where org_id = ${ctx.orgId} and (user_id is null or user_id = ${ctx.userId}) and read_at is null and (snoozed_until is null or snoozed_until <= now())`))[0]?.n ?? 0;
}

export async function markRead(ctx: Ctx, ids: string[] | 'all') {
  if (ids === 'all') {
    const r = await ctx.db.execute(sql`update notifications set read_at = now() where org_id = ${ctx.orgId} and read_at is null`);
    return { updated: (r as any).rowCount ?? 0 };
  }
  if (!ids.length) return { updated: 0 };
  const r = await ctx.db.execute(sql`update notifications set read_at = now() where org_id = ${ctx.orgId} and id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  return { updated: (r as any).rowCount ?? 0 };
}

export async function getPrefs(ctx: Ctx) {
  const [p] = await ctx.db.select().from(notificationPreferences).where(and(eq(notificationPreferences.orgId, ctx.orgId), eq(notificationPreferences.userId, ctx.userId!)));
  return p ?? null;
}

export async function updatePrefs(ctx: Ctx, patch: Partial<{ timezone: string; quietStart: string | null; quietEnd: string | null; inApp: boolean; browserPush: boolean; digestHour: number; rules: Record<string, boolean> }>) {
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (patch.quietStart && !hhmm.test(patch.quietStart)) throw badRequest('quietStart must be HH:MM');
  if (patch.quietEnd && !hhmm.test(patch.quietEnd)) throw badRequest('quietEnd must be HH:MM');
  const [p] = await ctx.db
    .insert(notificationPreferences)
    .values({ orgId: ctx.orgId, userId: ctx.userId!, ...patch })
    .onConflictDoUpdate({ target: [notificationPreferences.orgId, notificationPreferences.userId], set: { ...patch, updatedAt: new Date() } })
    .returning();
  return p!;
}

// ------------------------------------------------------------ event -> notification

interface OutboxRow {
  id: string;
  orgId: string;
  type: string;
  payload: Record<string, any>;
  createdAt: Date;
}

const hourKey = (d: Date) => d.toISOString().slice(0, 13);

/** Maps domain events to owner-visible notifications. Deduped so a flapping condition cannot spam. */
export async function dispatchEvent(db: Db, ev: OutboxRow, now = new Date()): Promise<void> {
  const p = ev.payload;
  const base = { orgId: ev.orgId, sourceType: 'event', sourceId: ev.id };
  switch (ev.type as EventType) {
    case 'agent.offline':
      await notify(db, { ...base, type: ev.type, dedupeKey: `agent.offline:${p.deviceId}:${hourKey(now)}`, title: `${p.name ?? p.hostname ?? 'A scanner agent'} went offline`, body: 'Files on that machine show as temporarily unavailable, not missing.', severity: 'WARNING', deepLink: '/storage' }, now);
      break;
    case 'agent.connected':
      if (p.paired) await notify(db, { ...base, type: ev.type, dedupeKey: `agent.connected:${p.deviceId}`, title: `${p.hostname ?? 'Device'} paired`, severity: 'INFO', deepLink: '/storage' }, now);
      break;
    case 'media.file.missing': {
      const [root] = p.rootId ? await db.select({ label: storageRoots.label }).from(storageRoots).where(eq(storageRoots.id, p.rootId)) : [];
      await notify(db, { ...base, type: ev.type, dedupeKey: `missing:${p.rootId}:${hourKey(now)}`, title: `Files no longer found${root ? ` in ${root.label}` : ''}`, body: 'They were present on an earlier scan. Check Library → Missing.', severity: 'WARNING', deepLink: '/library?availability=MISSING_CANDIDATE' }, now);
      break;
    }
    case 'invoice.overdue':
      await notify(db, { ...base, type: ev.type, dedupeKey: `invoice.overdue:${p.invoiceId}`, title: 'An invoice is overdue', severity: 'CRITICAL', deepLink: `/collaborations?deal=${p.dealId ?? ''}` }, now);
      break;
    case 'invoice.paid':
      await notify(db, { ...base, type: ev.type, dedupeKey: `invoice.paid:${p.invoiceId}`, title: 'Invoice paid', severity: 'INFO', deepLink: `/collaborations?deal=${p.dealId ?? ''}` }, now);
      break;
    case 'deal.inquiry.detected':
      await notify(db, { ...base, type: ev.type, dedupeKey: `inquiry:${p.threadId}`, title: 'Possible collaboration inquiry', body: 'Review it in the collaboration triage queue.', severity: 'INFO', deepLink: `/collaborations?thread=${p.threadId}` }, now);
      break;
    case 'deal.reply_required':
      await notify(db, { ...base, type: ev.type, dedupeKey: `reply:${p.threadId}:${hourKey(now)}`, title: 'A brand is waiting for your reply', severity: 'WARNING', deepLink: `/collaborations?thread=${p.threadId}` }, now);
      break;
    case 'deal.approval_received':
      await notify(db, { ...base, type: ev.type, dedupeKey: `approval:${p.deliverableId ?? p.dealId}:${hourKey(now)}`, title: 'Deliverable approval recorded', severity: 'INFO', deepLink: `/collaborations?deal=${p.dealId ?? ''}` }, now);
      break;
    case 'connector.sync.failed':
      await notify(db, { ...base, type: ev.type, dedupeKey: `sync.failed:${p.connectionId}:${hourKey(now)}`, title: `${p.provider} sync failed`, body: p.message, severity: p.kind === 'AUTH_EXPIRED' || p.kind === 'AUTH_REVOKED' ? 'CRITICAL' : 'WARNING', deepLink: '/integrations' }, now);
      break;
    case 'publication.discovered':
      await notify(db, { ...base, type: ev.type, dedupeKey: `pub.discovered:${hourKey(now)}`, title: 'New published posts imported', body: 'Match them to your assets in Publishing → Unmatched.', severity: 'INFO', deepLink: '/publishing?tab=unmatched' }, now);
      break;
    default:
      break; // events with no owner-facing meaning (action.*, todo.task.updated, scene completed) are intentionally silent
  }
}

/** Worker loop body: claims due events with SKIP LOCKED so several workers never double deliver. */
export async function processOutbox(db: Db, opts: { batch?: number; now?: Date } = {}): Promise<{ delivered: number; failed: number }> {
  const now = opts.now ?? new Date();
  let delivered = 0;
  let failed = 0;
  await db.transaction(async (tx) => {
    const rows = rowsOf<OutboxRow & { attempts: number }>(
      await tx.execute(sql`select id, org_id as "orgId", type, payload, created_at as "createdAt", attempts from outbox_events where state = 'PENDING' and next_attempt_at <= ${now.toISOString()}::timestamptz order by created_at limit ${opts.batch ?? 100} for update skip locked`),
    );
    for (const r of rows) {
      try {
        await dispatchEvent(tx as unknown as Db, r, now);
        await tx.update(outboxEvents).set({ state: 'DELIVERED', deliveredAt: now, attempts: r.attempts + 1 }).where(eq(outboxEvents.id, r.id));
        delivered += 1;
      } catch (e) {
        const attempts = r.attempts + 1;
        await tx.update(outboxEvents).set({ attempts, lastError: (e as Error).message.slice(0, 500), state: attempts >= 8 ? 'FAILED' : 'PENDING', nextAttemptAt: new Date(now.getTime() + Math.min(2 ** attempts * 30_000, 3_600_000)) }).where(eq(outboxEvents.id, r.id));
        failed += 1;
      }
    }
  });
  return { delivered, failed };
}
