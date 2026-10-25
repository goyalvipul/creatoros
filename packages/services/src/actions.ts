import { and, desc, eq, followUpRules, internalActions, sql, type Db } from '@creatoros/db';
import {
  localDay,
  rankCandidates,
  startOfLocalDay,
  addLocalDays,
  type Priority,
  type PriorityCandidate,
} from '@creatoros/domain';
import { audit, emit } from './audit';
import { badRequest, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ------------------------------------------------------------- manual CRUD

export async function createAction(
  ctx: Ctx,
  input: {
    title: string;
    description?: string | null;
    dueAt?: Date | string | null;
    priority?: Priority;
    deepLink?: string | null;
    pinned?: boolean;
    sourceType?: string;
    sourceId?: string | null;
  },
) {
  if (!input.title?.trim()) throw badRequest('Title is required');
  const [a] = await ctx.db
    .insert(internalActions)
    .values({
      orgId: ctx.orgId,
      title: input.title.trim(),
      description: input.description ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      priority: input.priority ?? 'NORMAL',
      deepLink: input.deepLink ?? null,
      pinned: input.pinned ?? false,
      sourceType: input.sourceType ?? 'manual',
      sourceId: input.sourceId ?? null,
      ownerUserId: ctx.userId,
      reason: 'Added by you',
    })
    .returning();
  await emit(ctx.db, ctx.orgId, 'action.created', { actionId: a!.id });
  await audit(ctx, 'action.create', { type: 'action', id: a!.id });
  return a!;
}

export async function listActions(
  ctx: Ctx,
  q: { state?: 'OPEN' | 'SNOOZED' | 'DONE' | 'DISMISSED'; includeSnoozed?: boolean; limit?: number } = {},
) {
  const where = [sql`org_id = ${ctx.orgId}`];
  if (q.state) where.push(sql`state = ${q.state}::action_state`);
  else
    where.push(
      q.includeSnoozed
        ? sql`state in ('OPEN','SNOOZED')`
        : sql`state = 'OPEN' and (snoozed_until is null or snoozed_until <= now())`,
    );
  return rowsOf<any>(
    await ctx.db.execute(
      sql`select id, source_type as "sourceType", source_id as "sourceId", rule_key as "ruleKey", title, description, reason, deep_link as "deepLink", due_at as "dueAt", priority, state, snoozed_until as "snoozedUntil", pinned, completed_at as "completedAt", created_at as "createdAt" from internal_actions where ${sql.join(where, sql` and `)} order by pinned desc, due_at asc nulls last, created_at desc limit ${Math.min(q.limit ?? 200, 1000)}`,
    ),
  );
}

async function transition(
  ctx: Ctx,
  id: string,
  set: Partial<typeof internalActions.$inferInsert>,
  audit_: string,
) {
  const [a] = await ctx.db
    .update(internalActions)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(internalActions.id, id), eq(internalActions.orgId, ctx.orgId)))
    .returning();
  if (!a) throw notFound('Action');
  await audit(ctx, audit_, { type: 'action', id }, undefined, set);
  return a;
}

export async function completeAction(ctx: Ctx, id: string, evidence?: string | null) {
  const a = await transition(
    ctx,
    id,
    { state: 'DONE', completedAt: new Date(), completionEvidence: evidence ?? null, snoozedUntil: null },
    'action.complete',
  );
  await emit(ctx.db, ctx.orgId, 'action.completed', { actionId: id });
  return a;
}
export const dismissAction = (ctx: Ctx, id: string) =>
  transition(ctx, id, { state: 'DISMISSED', dismissedAt: new Date() }, 'action.dismiss');
export const snoozeAction = (ctx: Ctx, id: string, until: Date) => {
  if (until.getTime() <= Date.now()) throw badRequest('Snooze time must be in the future');
  return transition(ctx, id, { state: 'SNOOZED', snoozedUntil: until }, 'action.snooze');
};
export const reopenAction = (ctx: Ctx, id: string) =>
  transition(
    ctx,
    id,
    { state: 'OPEN', snoozedUntil: null, completedAt: null, dismissedAt: null },
    'action.reopen',
  );
export const pinAction = (ctx: Ctx, id: string, pinned: boolean) =>
  transition(ctx, id, { pinned }, 'action.pin');

// ---------------------------------------------------------------- engine

interface AutoAction {
  ruleKey: string;
  dedupeKey: string;
  sourceType: string;
  sourceId: string;
  title: string;
  reason: string;
  dueAt?: Date | null;
  priority?: Priority;
  deepLink?: string;
}

type RuleCfg = Record<string, { enabled: boolean; hours: number | null; days: number[] | number | null }>;

async function loadRules(db: Db, orgId: string): Promise<RuleCfg> {
  const rows = await db.select().from(followUpRules).where(eq(followUpRules.orgId, orgId));
  const cfg: RuleCfg = {};
  for (const r of rows)
    cfg[r.key] = {
      enabled: r.enabled,
      hours: r.durationHours,
      days: ((r.condition as any)?.days as any) ?? (r.durationHours ? r.durationHours / 24 : null),
    };
  return cfg;
}

/**
 * Deterministic follow-up engine. Creates internal actions (never sends anything). Each open action has a stable dedupe key so
 * re-running is idempotent, snoozes are respected, and actions whose condition no longer holds are closed automatically.
 */
export async function runActionsEngine(
  db: Db,
  orgId: string,
  now = new Date(),
): Promise<{ created: number; updated: number; resolved: number }> {
  const rules = await loadRules(db, orgId);
  const on = (k: string) => rules[k]?.enabled !== false;
  const hoursOf = (k: string, d: number) => rules[k]?.hours ?? d;
  const daysOf = (k: string, d: number) =>
    typeof rules[k]?.days === 'number' ? (rules[k]!.days as number) : d;
  const found = new Map<string, AutoAction[]>();
  const add = (a: AutoAction) => found.set(a.ruleKey, [...(found.get(a.ruleKey) ?? []), a]);
  const iso = now.toISOString();

  if (on('inbound_unanswered')) {
    const h = hoursOf('inbound_unanswered', 24);
    for (const t of rowsOf<any>(
      await db.execute(sql`
      select t.id, t.subject, t.last_inbound_at as "lastInboundAt", t.deal_id as "dealId", t.opportunity_id as "oppId"
      from conversation_threads t
      where t.org_id = ${orgId} and t.state = 'NEED_REPLY' and t.merged_into_id is null and t.triage_state <> 'DISMISSED' and t.last_inbound_at is not null
        and (t.snooze_until is null or t.snooze_until <= ${iso}::timestamptz)
        and t.last_inbound_at <= ${iso}::timestamptz - make_interval(hours => ${h})
        and (t.deal_id is not null or t.opportunity_id is not null or exists (select 1 from messages m join inbound_classifications c on c.message_id = m.id where m.thread_id = t.id and c.category = 'COLLABORATION'))`),
    )) {
      const lastIn = new Date(t.lastInboundAt);
      add({
        ruleKey: 'inbound_unanswered',
        dedupeKey: `thread:${t.id}:reply:${lastIn.getTime()}`,
        sourceType: 'thread',
        sourceId: t.id,
        title: `Reply to: ${t.subject ?? '(no subject)'}`,
        reason: `Inbound message unanswered for ${Math.floor((now.getTime() - lastIn.getTime()) / HOUR)}h`,
        dueAt: new Date(lastIn.getTime() + h * HOUR),
        priority: t.dealId ? 'HIGH' : 'NORMAL',
        deepLink: `/collaborations/threads/${t.id}`,
      });
    }
  }
  if (on('reply_sla_warning')) {
    const warn = hoursOf('reply_sla_warning', 4);
    for (const t of rowsOf<any>(
      await db.execute(sql`
      select t.id, t.subject, t.last_inbound_at as "lastInboundAt", c.reply_sla_hours as sla
      from conversation_threads t join contacts c on c.id = t.contact_id
      where t.org_id = ${orgId} and t.state = 'NEED_REPLY' and c.reply_sla_hours is not null and t.last_inbound_at is not null
        and t.last_inbound_at + make_interval(hours => c.reply_sla_hours) <= ${iso}::timestamptz + make_interval(hours => ${warn})`),
    )) {
      const due = new Date(new Date(t.lastInboundAt).getTime() + t.sla * HOUR);
      add({
        ruleKey: 'reply_sla_warning',
        dedupeKey: `thread:${t.id}:sla:${new Date(t.lastInboundAt).getTime()}`,
        sourceType: 'thread',
        sourceId: t.id,
        title: `Reply SLA: ${t.subject ?? 'thread'}`,
        reason: due < now ? `Reply SLA of ${t.sla}h has passed` : `Reply SLA of ${t.sla}h expires soon`,
        dueAt: due,
        priority: due < now ? 'URGENT' : 'HIGH',
        deepLink: `/collaborations/threads/${t.id}`,
      });
    }
  }
  if (on('quote_followup')) {
    const d = daysOf('quote_followup', 5);
    for (const t of rowsOf<any>(
      await db.execute(sql`
      select t.id, t.subject, t.last_outbound_at as "lastOutboundAt" from conversation_threads t
      where t.org_id = ${orgId} and t.state = 'WAITING_FOR_BRAND' and t.last_outbound_at is not null and (t.deal_id is not null or t.opportunity_id is not null)
        and t.last_outbound_at <= ${iso}::timestamptz - make_interval(days => ${d})`),
    )) {
      add({
        ruleKey: 'quote_followup',
        dedupeKey: `thread:${t.id}:follow:${new Date(t.lastOutboundAt).getTime()}`,
        sourceType: 'thread',
        sourceId: t.id,
        title: `Follow up: ${t.subject ?? 'quote'}`,
        reason: `No reply for ${d}+ days after your last message`,
        dueAt: new Date(new Date(t.lastOutboundAt).getTime() + d * DAY),
        priority: 'NORMAL',
        deepLink: `/collaborations/threads/${t.id}`,
      });
    }
  }
  if (on('deliverable_due')) {
    const days = Array.isArray(rules['deliverable_due']?.days)
      ? (rules['deliverable_due']!.days as number[])
      : [7, 3, 1];
    const horizon = Math.max(...days);
    for (const x of rowsOf<any>(
      await db.execute(sql`
      select x.id, x.title, x.due_at as "dueAt", x.deal_id as "dealId", d.title as "dealTitle" from deal_deliverables x join deals d on d.id = x.deal_id
      where x.org_id = ${orgId} and x.status in ('PLANNED','IN_PROGRESS','CHANGES_REQUESTED') and x.due_at is not null and d.deleted_at is null and d.stage not in ('PAID_CLOSED','DECLINED','LOST')
        and x.due_at <= ${iso}::timestamptz + make_interval(days => ${horizon})`),
    )) {
      const left = (new Date(x.dueAt).getTime() - now.getTime()) / DAY;
      add({
        ruleKey: 'deliverable_due',
        dedupeKey: `deliverable:${x.id}:due`,
        sourceType: 'deliverable',
        sourceId: x.id,
        title: `Deliver: ${x.title} (${x.dealTitle})`,
        reason:
          left < 0
            ? `Overdue by ${Math.ceil(-left)} day(s)`
            : `Due in ${Math.max(0, Math.ceil(left))} day(s)`,
        dueAt: new Date(x.dueAt),
        priority: left < 0 ? 'URGENT' : left <= 1 ? 'HIGH' : 'NORMAL',
        deepLink: `/collaborations/deals/${x.dealId}`,
      });
    }
  }
  if (on('approval_overdue')) {
    const d = daysOf('approval_overdue', 3);
    for (const x of rowsOf<any>(
      await db.execute(sql`
      select x.id, x.title, x.submitted_at as "submittedAt", x.deal_id as "dealId" from deal_deliverables x
      where x.org_id = ${orgId} and x.status = 'SUBMITTED' and x.submitted_at <= ${iso}::timestamptz - make_interval(days => ${d})`),
    )) {
      add({
        ruleKey: 'approval_overdue',
        dedupeKey: `deliverable:${x.id}:approval`,
        sourceType: 'deliverable',
        sourceId: x.id,
        title: `Chase approval: ${x.title}`,
        reason: `Submitted ${Math.floor((now.getTime() - new Date(x.submittedAt).getTime()) / DAY)} days ago with no recorded approval`,
        dueAt: new Date(new Date(x.submittedAt).getTime() + d * DAY),
        priority: 'NORMAL',
        deepLink: `/collaborations/deals/${x.dealId}`,
      });
    }
  }
  if (on('report_due')) {
    const d = daysOf('report_due', 2);
    for (const x of rowsOf<any>(
      await db.execute(sql`
      select id, title, stage_changed_at as "at" from deals where org_id = ${orgId} and deleted_at is null and stage = 'PUBLISHED' and stage_changed_at <= ${iso}::timestamptz - make_interval(days => ${d})`),
    )) {
      add({
        ruleKey: 'report_due',
        dedupeKey: `deal:${x.id}:report`,
        sourceType: 'deal',
        sourceId: x.id,
        title: `Send campaign report: ${x.title}`,
        reason: `Published ${d}+ days ago, report not marked sent`,
        dueAt: new Date(new Date(x.at).getTime() + d * DAY),
        priority: 'NORMAL',
        deepLink: `/collaborations/deals/${x.id}`,
      });
    }
  }
  if (on('invoice_due')) {
    const d = daysOf('invoice_due', 3);
    for (const i of rowsOf<any>(
      await db.execute(sql`
      select i.id, i.invoice_no as "no", i.due_at as "dueAt", i.deal_id as "dealId", (i.amount_minor - i.paid_total_minor)::float8 as due, i.currency
      from invoices i where i.org_id = ${orgId} and i.status in ('ISSUED','SENT','CONFIRMED','PARTIALLY_PAID','OVERDUE') and i.due_at is not null and i.paid_total_minor < i.amount_minor
        and i.due_at <= ${iso}::timestamptz + make_interval(days => ${d})`),
    )) {
      const late = new Date(i.dueAt) < now;
      add({
        ruleKey: 'invoice_due',
        dedupeKey: `invoice:${i.id}:due`,
        sourceType: 'invoice',
        sourceId: i.id,
        title: late ? `Chase payment: invoice ${i.no}` : `Invoice ${i.no} due soon`,
        reason: late ? 'Invoice is overdue' : 'Invoice due within a few days',
        dueAt: new Date(i.dueAt),
        priority: late ? 'URGENT' : 'HIGH',
        deepLink: `/collaborations/invoices/${i.id}`,
      });
    }
  }
  if (on('commission_payout')) {
    const d = daysOf('commission_payout', 2);
    for (const x of rowsOf<any>(
      await db.execute(sql`
      select id, title, stage_changed_at as "at" from deals where org_id = ${orgId} and deleted_at is null and compensation_type in ('AFFILIATE','COMMISSION','MIXED') and stage = 'AWAITING_PAYMENT' and stage_changed_at <= ${iso}::timestamptz - make_interval(days => ${d})`),
    )) {
      add({
        ruleKey: 'commission_payout',
        dedupeKey: `deal:${x.id}:payout`,
        sourceType: 'deal',
        sourceId: x.id,
        title: `Check commission payout: ${x.title}`,
        reason: 'Awaiting payment for a commission/affiliate deal',
        dueAt: new Date(new Date(x.at).getTime() + d * DAY),
        priority: 'NORMAL',
        deepLink: `/collaborations/deals/${x.id}`,
      });
    }
  }
  if (on('thank_you')) {
    const d = daysOf('thank_you', 2);
    for (const x of rowsOf<any>(
      await db.execute(sql`
      select id, title, closed_at as "at" from deals where org_id = ${orgId} and deleted_at is null and stage = 'PAID_CLOSED' and closed_at <= ${iso}::timestamptz - make_interval(days => ${d}) and closed_at > ${iso}::timestamptz - make_interval(days => 14)`),
    )) {
      add({
        ruleKey: 'thank_you',
        dedupeKey: `deal:${x.id}:thanks`,
        sourceType: 'deal',
        sourceId: x.id,
        title: `Send thank-you: ${x.title}`,
        reason: 'Campaign closed and paid',
        dueAt: new Date(new Date(x.at).getTime() + d * DAY),
        priority: 'LOW',
        deepLink: `/collaborations/deals/${x.id}`,
      });
    }
  }
  // publishing: planned time passed without a published record, or posts due within a day that are not ready
  for (const p of rowsOf<any>(
    await db.execute(sql`
    select r.id, r.variant_id as "variantId", coalesce(r.title, 'post') as title, r.planned_at as "plannedAt", r.state, sa.platform from publication_records r join social_accounts sa on sa.id = r.social_account_id
    where r.org_id = ${orgId} and r.planned_at is not null and r.state in ('PLANNED','READY','SCHEDULED') and r.planned_at <= ${iso}::timestamptz + interval '24 hours'`),
  )) {
    const late = new Date(p.plannedAt) < now;
    add({
      ruleKey: 'publication_due',
      dedupeKey: `publication:${p.id}:due`,
      sourceType: 'publication',
      sourceId: p.id,
      title: late
        ? `Confirm or reschedule: ${p.title} (${p.platform})`
        : `Publish ${p.title} on ${p.platform}`,
      reason: late
        ? 'Planned time has passed and it is not recorded as published'
        : p.state === 'READY'
          ? 'Ready and planned within 24h'
          : `Planned within 24h but still ${p.state}`,
      dueAt: new Date(p.plannedAt),
      priority: late ? 'HIGH' : 'NORMAL',
      deepLink: p.variantId ? `/publishing/${p.variantId}` : `/publishing?tab=unmatched`,
    });
  }

  let created = 0;
  let updated = 0;
  const ruleKeys = new Set<string>([
    ...found.keys(),
    'inbound_unanswered',
    'reply_sla_warning',
    'quote_followup',
    'deliverable_due',
    'approval_overdue',
    'report_due',
    'invoice_due',
    'commission_payout',
    'thank_you',
    'publication_due',
  ]);
  const activeKeys = new Set<string>();
  for (const list of found.values()) {
    for (const a of list) {
      activeKeys.add(a.dedupeKey);
      const [existing] = await db
        .select()
        .from(internalActions)
        .where(
          and(
            eq(internalActions.orgId, orgId),
            eq(internalActions.dedupeKey, a.dedupeKey),
            sql`${internalActions.state} in ('OPEN','SNOOZED')`,
          ),
        );
      if (existing) {
        await db
          .update(internalActions)
          .set({
            title: a.title,
            reason: a.reason,
            dueAt: a.dueAt ?? null,
            priority: a.priority ?? 'NORMAL',
            deepLink: a.deepLink ?? null,
            updatedAt: new Date(),
          })
          .where(eq(internalActions.id, existing.id));
        updated += 1;
      } else {
        // a previously completed/dismissed action with the same key must not come back
        const [closed] = await db
          .select({ id: internalActions.id })
          .from(internalActions)
          .where(and(eq(internalActions.orgId, orgId), eq(internalActions.dedupeKey, a.dedupeKey)));
        if (closed) continue;
        const [row] = await db
          .insert(internalActions)
          .values({
            orgId,
            sourceType: a.sourceType,
            sourceId: a.sourceId,
            ruleKey: a.ruleKey,
            dedupeKey: a.dedupeKey,
            title: a.title,
            reason: a.reason,
            dueAt: a.dueAt ?? null,
            priority: a.priority ?? 'NORMAL',
            deepLink: a.deepLink ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: internalActions.id });
        if (row) {
          created += 1;
          await emit(db, orgId, 'action.created', { actionId: row.id, ruleKey: a.ruleKey });
        }
      }
    }
  }
  // auto-resolve actions whose trigger condition has cleared
  const open = await db
    .select()
    .from(internalActions)
    .where(
      and(
        eq(internalActions.orgId, orgId),
        sql`${internalActions.state} in ('OPEN','SNOOZED')`,
        sql`${internalActions.dedupeKey} is not null`,
      ),
    );
  let resolved = 0;
  for (const a of open) {
    if (a.ruleKey && ruleKeys.has(a.ruleKey) && a.dedupeKey && !activeKeys.has(a.dedupeKey)) {
      await db
        .update(internalActions)
        .set({
          state: 'DONE',
          completedAt: new Date(),
          completionEvidence: 'Condition cleared automatically',
          updatedAt: new Date(),
        })
        .where(eq(internalActions.id, a.id));
      resolved += 1;
    }
  }
  return { created, updated, resolved };
}

// --------------------------------------------------------------- briefing

/** Page that holds the record this action was raised from. */
export function actionSourcePath(a: {
  id: string;
  sourceType?: string | null;
  sourceId?: string | null;
  deepLink?: string | null;
}): string {
  const id = a.sourceId ?? undefined;
  if (a.sourceType === 'thread' && id) return `/collaborations/threads/${id}`;
  if (a.sourceType === 'invoice' && id) return `/collaborations/invoices/${id}`;
  if (a.sourceType === 'deal' && id) return `/collaborations/deals/${id}`;
  if (a.sourceType === 'deliverable') {
    const deal =
      a.deepLink?.match(/\/deals\/([0-9a-f-]{36})/i)?.[1] ?? a.deepLink?.match(/deal=([0-9a-f-]{36})/i)?.[1];
    if (deal) return `/collaborations/deals/${deal}`;
  }
  if (
    a.sourceType === 'publication' &&
    (a.deepLink?.startsWith('/publishing/') || a.deepLink === '/publishing?tab=unmatched')
  )
    return a.deepLink;
  if (a.sourceType === 'publication') return '/publishing?tab=unmatched';
  return `/today?action=${a.id}`;
}

/** "What matters now": top 3 with reasons plus live counters. Fully deterministic, no AI. */
export async function briefing(ctx: Ctx, now = new Date()) {
  const tz =
    rowsOf<{ timezone: string }>(
      await ctx.db.execute(sql`select timezone from organizations where id = ${ctx.orgId}`),
    )[0]?.timezone ?? 'America/Vancouver';
  const actions = await listActions(ctx, { limit: 300 });
  const dealValue = new Map<string, number>();
  const candidates: PriorityCandidate[] = actions.map((a) => ({
    id: a.id,
    kind: `action:${a.sourceType}`,
    title: a.title,
    dueAt: a.dueAt,
    priority: a.priority,
    pinned: a.pinned,
    snoozedUntil: a.snoozedUntil,
    dealValue: a.sourceType === 'deal' ? dealValue.get(a.sourceId) : null,
  }));
  const projects = rowsOf<any>(
    await ctx.db.execute(sql`
    select p.id, p.title, p.due_at as "dueAt", p.priority,
      (select count(*)::float8 from production_scenes s where s.project_id = p.id) as total,
      (select count(*)::float8 from production_scenes s where s.project_id = p.id and s.status = 'SELECTED') as done
    from creative_projects p where p.org_id = ${ctx.orgId} and p.deleted_at is null and p.stage not in ('ARCHIVED','DISTRIBUTING') and p.due_at is not null and p.due_at <= ${new Date(now.getTime() + 7 * DAY).toISOString()}::timestamptz`),
  );
  for (const p of projects)
    candidates.push({
      id: p.id,
      kind: 'project',
      title: `Project due: ${p.title}`,
      dueAt: p.dueAt,
      priority: p.priority,
      readiness: p.total ? p.done / p.total : 0,
    });
  const top = rankCandidates(candidates, now, 3).map((c) => ({
    id: c.id,
    kind: c.kind,
    title: c.title,
    dueAt: c.dueAt,
    score: c.score,
    reasons: c.reasons,
    deepLink: (() => {
      const action = actions.find((a) => a.id === c.id);
      if (action) return actionSourcePath(action);
      return c.kind === 'project' ? `/production/${c.id}` : null;
    })(),
  }));

  const n = async (q: ReturnType<typeof sql>) => rowsOf<{ n: number }>(await ctx.db.execute(q))[0]?.n ?? 0;
  const dayStart = startOfLocalDay(now, tz);
  const dayEnd = addLocalDays(dayStart, 1, tz);
  const counts = {
    needReply: await n(
      sql`select count(*)::int as n from conversation_threads where org_id = ${ctx.orgId} and state = 'NEED_REPLY' and merged_into_id is null and triage_state <> 'DISMISSED' and (deal_id is not null or opportunity_id is not null)`,
    ),
    possibleCollabs: await n(
      sql`select count(distinct t.id)::int as n from conversation_threads t join messages m on m.thread_id = t.id join inbound_classifications c on c.message_id = m.id where t.org_id = ${ctx.orgId} and t.triage_state = 'POSSIBLE' and t.opportunity_id is null and c.category = 'COLLABORATION'`,
    ),
    overdueInvoices: await n(
      sql`select count(*)::int as n from invoices where org_id = ${ctx.orgId} and status = 'OVERDUE'`,
    ),
    dueToday: await n(
      sql`select count(*)::int as n from internal_actions where org_id = ${ctx.orgId} and state = 'OPEN' and due_at >= ${dayStart.toISOString()}::timestamptz and due_at < ${dayEnd.toISOString()}::timestamptz`,
    ),
    openActions: actions.length,
    scheduledToday: await n(
      sql`select count(*)::int as n from publication_records where org_id = ${ctx.orgId} and state <> 'REMOVED' and planned_at >= ${dayStart.toISOString()}::timestamptz and planned_at < ${dayEnd.toISOString()}::timestamptz and state in ('PLANNED','READY','SCHEDULED')`,
    ),
    devicesOffline: await n(
      sql`select count(*)::int as n from devices where org_id = ${ctx.orgId} and state in ('OFFLINE') and revoked_at is null`,
    ),
    unlinkedMedia: await n(
      sql`select count(*)::int as n from file_instances f where f.org_id = ${ctx.orgId} and f.archived_at is null and f.file_type in ('VIDEO','AUDIO') and not exists (select 1 from asset_file_links l where l.file_instance_id = f.id)`,
    ),
    unmatchedPublications: await n(
      sql`select count(*)::int as n from publication_records where org_id = ${ctx.orgId} and unmatched_import and variant_id is null and state <> 'REMOVED'`,
    ),
  };
  return { generatedAt: now.toISOString(), timezone: tz, today: localDay(now, tz), top, counts };
}

export async function recentCompleted(ctx: Ctx, limit = 20) {
  return ctx.db
    .select()
    .from(internalActions)
    .where(and(eq(internalActions.orgId, ctx.orgId), eq(internalActions.state, 'DONE')))
    .orderBy(desc(internalActions.completedAt))
    .limit(limit);
}
