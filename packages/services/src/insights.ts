import { and, analyticsSnapshots, eq, goalObservations, goals, sql, type Db } from '@creatoros/db';
import {
  addLocalDays,
  localDay,
  startOfLocalDay,
  utcToZonedParts,
  zonedToUtc,
  type Provenance,
} from '@creatoros/domain';
import { audit } from './audit';
import { badRequest, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ------------------------------------------------------------------ search

export interface SearchHit {
  type:
    | 'file'
    | 'asset'
    | 'project'
    | 'idea'
    | 'deal'
    | 'thread'
    | 'contact'
    | 'publication'
    | 'organization'
    | 'action';
  id: string;
  title: string;
  subtitle: string | null;
  link: string;
}

/** Global search across everything the owner might look for. Trigram-backed ILIKE; owner scoped; capped per type. */
const PRIVATE_SEARCH_TYPES = new Set<SearchHit['type']>([
  'file',
  'deal',
  'thread',
  'contact',
  'organization',
]);

/** `includePrivate=false` (viewers) skips files, email and CRM entities. */
export async function search(ctx: Ctx, q: string, perType = 6, includePrivate = true): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${esc(term)}%`;
  const n = perType;
  const org = ctx.orgId;
  const run = async (type: SearchHit['type'], query: ReturnType<typeof sql>) =>
    !includePrivate && PRIVATE_SEARCH_TYPES.has(type)
      ? []
      : rowsOf<any>(await ctx.db.execute(query)).map((r) => ({ type, ...r }) as SearchHit);
  const parts = await Promise.all([
    run(
      'file',
      sql`select f.id, f.file_name as title, f.display_path as subtitle, '/library?file=' || f.id as link from file_instances f where f.org_id = ${org} and f.archived_at is null and (f.file_name ilike ${like} or f.display_path ilike ${like}) order by similarity(f.file_name, ${term}) desc limit ${n}`,
    ),
    run(
      'asset',
      sql`select id, title, kind::text as subtitle, '/library?asset=' || id as link from logical_assets where org_id = ${org} and is_archived = false and title ilike ${like} limit ${n}`,
    ),
    run(
      'project',
      sql`select id, title, stage::text as subtitle, '/production/' || id as link from creative_projects where org_id = ${org} and deleted_at is null and (title ilike ${like} or brief ilike ${like}) limit ${n}`,
    ),
    run(
      'idea',
      sql`select id, title, status::text as subtitle, '/content?idea=' || id as link from ideas where org_id = ${org} and deleted_at is null and (title ilike ${like} or pitch ilike ${like}) limit ${n}`,
    ),
    run(
      'deal',
      sql`select id, title, stage::text as subtitle, '/collaborations?deal=' || id as link from deals where org_id = ${org} and deleted_at is null and (title ilike ${like} or campaign ilike ${like}) limit ${n}`,
    ),
    run(
      'thread',
      sql`select id, coalesce(subject, '(no subject)') as title, state::text as subtitle, '/collaborations?thread=' || id as link from conversation_threads where org_id = ${org} and subject ilike ${like} limit ${n}`,
    ),
    run(
      'contact',
      sql`select id, name as title, array_to_string(emails, ', ') as subtitle, '/collaborations?contact=' || id as link from contacts where org_id = ${org} and deleted_at is null and (name ilike ${like} or array_to_string(emails, ' ') ilike ${like}) limit ${n}`,
    ),
    run(
      'organization',
      sql`select id, name as title, kind::text as subtitle, '/collaborations?org=' || id as link from external_organizations where org_id = ${org} and deleted_at is null and name ilike ${like} limit ${n}`,
    ),
    run(
      'publication',
      sql`select id, coalesce(title, canonical_url, 'publication') as title, state::text as subtitle, '/publishing?pub=' || id as link from publication_records where org_id = ${org} and (title ilike ${like} or canonical_url ilike ${like}) limit ${n}`,
    ),
    run(
      'action',
      sql`select id, title, state::text as subtitle, '/inbox?action=' || id as link from internal_actions where org_id = ${org} and title ilike ${like} limit ${n}`,
    ),
  ]);
  return parts.flat();
}

// --------------------------------------------------------------- periods

export type Period = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

/** Period boundaries in the owner's timezone (weeks start on Monday). DST safe: boundaries are local midnights converted to UTC. */
export function periodBounds(period: Period, now: Date, tz: string): { start: Date; end: Date } {
  const p = utcToZonedParts(now, tz);
  if (period === 'WEEK') {
    const dayStart = startOfLocalDay(now, tz);
    const back = (p.weekday + 6) % 7;
    const start = addLocalDays(dayStart, -back, tz);
    return { start, end: addLocalDays(start, 7, tz) };
  }
  if (period === 'MONTH')
    return {
      start: zonedToUtc({ year: p.year, month: p.month, day: 1 }, tz),
      end: zonedToUtc(
        { year: p.month === 12 ? p.year + 1 : p.year, month: p.month === 12 ? 1 : p.month + 1, day: 1 },
        tz,
      ),
    };
  if (period === 'QUARTER') {
    const qm = Math.floor((p.month - 1) / 3) * 3 + 1;
    const nm = qm + 3;
    return {
      start: zonedToUtc({ year: p.year, month: qm, day: 1 }, tz),
      end: zonedToUtc({ year: nm > 12 ? p.year + 1 : p.year, month: nm > 12 ? nm - 12 : nm, day: 1 }, tz),
    };
  }
  return {
    start: zonedToUtc({ year: p.year, month: 1, day: 1 }, tz),
    end: zonedToUtc({ year: p.year + 1, month: 1, day: 1 }, tz),
  };
}

async function orgTz(db: Db, orgId: string): Promise<{ tz: string; base: string }> {
  const r = rowsOf<{ timezone: string; base: string }>(
    await db.execute(sql`select timezone, base_currency as base from organizations where id = ${orgId}`),
  )[0];
  return { tz: r?.timezone ?? 'America/Vancouver', base: r?.base ?? 'CAD' };
}

// --------------------------------------------------------------- analytics

export interface AnalyticsQuery {
  from?: Date;
  to?: Date;
  brandId?: string;
  socialAccountId?: string;
  platform?: string;
}

/**
 * Analytics are computed from our own records with explicit provenance. Posts confirmed by a platform API (VERIFIED) are
 * counted separately from posts the owner marked as published manually; view counts are labelled with where they came from.
 */
export async function analytics(ctx: Ctx, q: AnalyticsQuery = {}) {
  const { tz } = await orgTz(ctx.db, ctx.orgId);
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - 30 * 86400_000);
  const where = [
    sql`r.org_id = ${ctx.orgId}`,
    sql`r.state in ('PUBLISHED_VERIFIED','PUBLISHED_MANUAL')`,
    sql`r.published_at >= ${from.toISOString()}::timestamptz`,
    sql`r.published_at < ${to.toISOString()}::timestamptz`,
  ];
  if (q.socialAccountId) where.push(sql`r.social_account_id = ${q.socialAccountId}`);
  if (q.platform) where.push(sql`sa.platform = ${q.platform}::platform`);
  if (q.brandId) where.push(sql`c.brand_id = ${q.brandId}`);
  const rows = rowsOf<any>(
    await ctx.db.execute(sql`
      select r.id, r.title, r.state, r.state_provenance as provenance, r.published_at as "publishedAt", r.canonical_url as url, sa.platform, sa.handle,
             (r.latest_stats->>'views')::float8 as views, r.latest_stats->>'provenance' as "statsProvenance"
      from publication_records r join social_accounts sa on sa.id = r.social_account_id join channels c on c.id = sa.channel_id
      where ${sql.join(where, sql` and `)} order by r.published_at desc`),
  );
  const byPlatform: Record<string, { verified: number; manual: number; views: number | null }> = {};
  const byDay: Record<string, { verified: number; manual: number }> = {};
  for (const r of rows) {
    const bp = (byPlatform[r.platform] ??= { verified: 0, manual: 0, views: null });
    const d = (byDay[localDay(r.publishedAt, tz)] ??= { verified: 0, manual: 0 });
    if (r.state === 'PUBLISHED_VERIFIED') {
      bp.verified += 1;
      d.verified += 1;
    } else {
      bp.manual += 1;
      d.manual += 1;
    }
    if (r.views != null) bp.views = (bp.views ?? 0) + r.views;
  }
  const withViews = rows
    .filter((r) => r.views != null)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);
  return {
    timezone: tz,
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      published: rows.length,
      verified: rows.filter((r) => r.state === 'PUBLISHED_VERIFIED').length,
      manual: rows.filter((r) => r.state === 'PUBLISHED_MANUAL').length,
      postsWithViewData: withViews.length,
    },
    byPlatform,
    byDay,
    topPosts: withViews.map((r) => ({
      id: r.id,
      title: r.title,
      platform: r.platform,
      url: r.url,
      views: r.views,
      statsProvenance: r.statsProvenance ?? 'UNKNOWN',
    })),
    notes: [
      '"verified" = confirmed by the platform API; "manual" = you marked it published. View counts show their source and are absent when never synced or entered.',
    ],
  };
}

/** Daily computed snapshot (worker). Idempotent per day. */
export async function snapshotAnalytics(db: Db, orgId: string, now = new Date()) {
  const { tz } = await orgTz(db, orgId);
  const dayStart = startOfLocalDay(now, tz);
  const dayEnd = addLocalDays(dayStart, 1, tz);
  const r = rowsOf<{ verified: number; manual: number }>(
    await db.execute(
      sql`select count(*) filter (where state='PUBLISHED_VERIFIED')::int as verified, count(*) filter (where state='PUBLISHED_MANUAL')::int as manual from publication_records where org_id = ${orgId} and published_at >= ${dayStart.toISOString()}::timestamptz and published_at < ${dayEnd.toISOString()}::timestamptz`,
    ),
  )[0]!;
  await db.execute(
    sql`insert into analytics_snapshots (org_id, period, period_start, period_end, timezone, metrics, provenance, source) values (${orgId}, 'DAY', ${dayStart.toISOString()}::timestamptz, ${dayEnd.toISOString()}::timestamptz, ${tz}, ${JSON.stringify({ postsVerified: r.verified, postsManual: r.manual })}::jsonb, 'ESTIMATED', 'computed') on conflict (org_id, coalesce(social_account_id, '00000000-0000-0000-0000-000000000000'::uuid), period, period_start, source) do update set metrics = excluded.metrics`,
  );
  return r;
}

// ------------------------------------------------------------------- goals

export interface GoalInput {
  name: string;
  period?: Period;
  metric?: (typeof goals.$inferInsert)['metric'];
  customMetric?: string | null;
  targetValue: number;
  unit?: string;
  kind?: 'ACTIVITY' | 'OUTCOME';
  brandId?: string | null;
  channelId?: string | null;
}

export async function createGoal(ctx: Ctx, input: GoalInput) {
  if (!(input.targetValue > 0)) throw badRequest('Target must be positive');
  const [g] = await ctx.db
    .insert(goals)
    .values({
      orgId: ctx.orgId,
      name: input.name.trim(),
      period: input.period ?? 'MONTH',
      metric: input.metric ?? 'RELEASES',
      customMetric: input.customMetric ?? null,
      targetValue: input.targetValue,
      unit: input.unit ?? 'count',
      kind: input.kind ?? 'ACTIVITY',
      brandId: input.brandId ?? null,
      channelId: input.channelId ?? null,
      history: [{ at: new Date().toISOString(), targetValue: input.targetValue, revision: 1 }],
    })
    .returning();
  await audit(ctx, 'goal.create', { type: 'goal', id: g!.id });
  return g!;
}

/** Changing a target keeps the history so past periods are still judged against the target that applied then. */
export async function updateGoal(ctx: Ctx, id: string, patch: Partial<GoalInput> & { active?: boolean }) {
  const [g] = await ctx.db
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.orgId, ctx.orgId)));
  if (!g) throw notFound('Goal');
  const targetChanged = patch.targetValue !== undefined && patch.targetValue !== g.targetValue;
  if (patch.targetValue !== undefined && !(patch.targetValue > 0))
    throw badRequest('Target must be positive');
  const [after] = await ctx.db
    .update(goals)
    .set({
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.period ? { period: patch.period } : {}),
      ...(patch.metric ? { metric: patch.metric } : {}),
      ...(patch.customMetric !== undefined ? { customMetric: patch.customMetric } : {}),
      ...(patch.unit ? { unit: patch.unit } : {}),
      ...(patch.kind ? { kind: patch.kind } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(targetChanged
        ? {
            targetValue: patch.targetValue!,
            revision: g.revision + 1,
            history: [
              ...g.history,
              { at: new Date().toISOString(), targetValue: patch.targetValue!, revision: g.revision + 1 },
            ],
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(goals.id, id))
    .returning();
  await audit(ctx, 'goal.update', { type: 'goal', id }, g, after);
  return after!;
}

export async function recordGoalObservation(
  ctx: Ctx,
  goalId: string,
  actual: number,
  source: Provenance = 'USER_ENTERED',
  now = new Date(),
) {
  const [g] = await ctx.db
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.orgId, ctx.orgId)));
  if (!g) throw notFound('Goal');
  const { tz } = await orgTz(ctx.db, ctx.orgId);
  const { start } = periodBounds(g.period as Period, now, tz);
  const [o] = await ctx.db
    .insert(goalObservations)
    .values({ orgId: ctx.orgId, goalId, periodStart: start, actual, source })
    .onConflictDoUpdate({
      target: [goalObservations.goalId, goalObservations.periodStart],
      set: { actual, source, snapshotAt: new Date() },
    })
    .returning();
  return o!;
}

export async function goalProgress(ctx: Ctx, g: typeof goals.$inferSelect, now = new Date()) {
  const { tz, base } = await orgTz(ctx.db, ctx.orgId);
  const { start, end } = periodBounds(g.period as Period, now, tz);
  const s = start.toISOString();
  const e = end.toISOString();
  const n = async (query: ReturnType<typeof sql>) =>
    rowsOf<{ n: number | null }>(await ctx.db.execute(query))[0]?.n ?? 0;
  let actual = 0;
  let provenance: Provenance = 'ESTIMATED';
  let derived = true;
  switch (g.metric) {
    case 'RELEASES':
      actual = await n(
        sql`select count(*)::float8 as n from publication_records r join distribution_variants v on v.id = r.variant_id where r.org_id = ${ctx.orgId} and r.state in ('PUBLISHED_VERIFIED','PUBLISHED_MANUAL') and r.published_at >= ${s}::timestamptz and r.published_at < ${e}::timestamptz and v.format in ('MASTER','LONG_FORM','LYRIC_VIDEO')`,
      );
      break;
    case 'VIDEOS_PUBLISHED':
      actual = await n(
        sql`select count(*)::float8 as n from publication_records where org_id = ${ctx.orgId} and state in ('PUBLISHED_VERIFIED','PUBLISHED_MANUAL') and published_at >= ${s}::timestamptz and published_at < ${e}::timestamptz`,
      );
      break;
    case 'WATCH_HOURS':
      actual = await n(
        sql`select coalesce(sum(m.watch_time_seconds),0)::float8 / 3600 as n from (select distinct on (publication_id) * from publication_metrics_snapshots where org_id = ${ctx.orgId} and provenance = 'VERIFIED_PLATFORM' order by publication_id, snapshot_at desc) m join publication_records r on r.id = m.publication_id where r.published_at >= ${s}::timestamptz and r.published_at < ${e}::timestamptz`,
      );
      provenance = 'VERIFIED_PLATFORM';
      break;
    case 'REPLY_SLA_HOURS':
      actual = await n(
        sql`select coalesce(avg(extract(epoch from (o.received_at - i.received_at)) / 3600), 0)::float8 as n from messages i join lateral (select m2.received_at from messages m2 where m2.thread_id = i.thread_id and m2.direction = 'OUTBOUND' and m2.received_at > i.received_at order by m2.received_at limit 1) o on true where i.org_id = ${ctx.orgId} and i.direction = 'INBOUND' and i.received_at >= ${s}::timestamptz and i.received_at < ${e}::timestamptz`,
      );
      break;
    case 'REVENUE_MINOR':
      actual = await n(
        sql`select coalesce(sum(amount_minor),0)::float8 as n from payments where org_id = ${ctx.orgId} and currency = ${base} and received_at >= ${s}::timestamptz and received_at < ${e}::timestamptz`,
      );
      provenance = 'USER_ENTERED';
      break;
    default: {
      derived = false;
      const o = rowsOf<{ actual: number; source: Provenance }>(
        await ctx.db.execute(
          sql`select actual, source from goal_observations where goal_id = ${g.id} and period_start = ${s}::timestamptz`,
        ),
      )[0];
      actual = o?.actual ?? 0;
      provenance = o?.source ?? 'UNKNOWN';
    }
  }
  const total = end.getTime() - start.getTime();
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / total));
  const pct = Math.round((actual / g.targetValue) * 1000) / 10;
  // lower is better for SLA-type goals
  const lowerIsBetter = g.metric === 'REPLY_SLA_HOURS';
  const achieved = lowerIsBetter ? actual > 0 && actual <= g.targetValue : actual >= g.targetValue;
  const status = achieved
    ? 'ACHIEVED'
    : lowerIsBetter
      ? 'BEHIND'
      : actual / g.targetValue >= elapsed - 0.05
        ? 'ON_TRACK'
        : 'BEHIND';
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    actual: Math.round(actual * 100) / 100,
    target: g.targetValue,
    pct,
    expectedPct: Math.round(elapsed * 1000) / 10,
    status,
    provenance,
    derived,
    needsManualEntry: !derived && provenance === 'UNKNOWN',
  };
}

export async function listGoals(ctx: Ctx, now = new Date()) {
  const rows = await ctx.db
    .select()
    .from(goals)
    .where(and(eq(goals.orgId, ctx.orgId), eq(goals.active, true)))
    .orderBy(goals.createdAt);
  const out = [];
  for (const g of rows) out.push({ ...g, progress: await goalProgress(ctx, g, now) });
  return out;
}

void analyticsSnapshots;
