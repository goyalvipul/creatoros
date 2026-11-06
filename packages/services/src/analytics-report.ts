import { sql } from '@creatoros/db';
import { classifyMetric, connectorCapabilities, type MetricState } from '@creatoros/domain';
import type { Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

export interface AnalyticsFilters {
  from?: Date;
  to?: Date;
  brandId?: string;
  socialAccountId?: string;
  platform?: string;
  song?: string;
  contentType?: string;
  campaignId?: string;
}

function numberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function stateOf(value: number | null, supported: boolean, recorded: boolean): { state: MetricState; value: number | null } {
  if (!supported) return { state: 'UNAVAILABLE', value: null };
  if (!recorded) return { state: 'UNKNOWN', value: null };
  return classifyMetric(value, true);
}

/** Read model for the dashboard. Numbers come from stored posts and snapshots, never from a live guess. */
export async function analyticsDetail(ctx: Ctx, q: AnalyticsFilters, tz: string) {
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - 30 * 86400_000);
  const where = [
    sql`r.org_id = ${ctx.orgId}`,
    sql`r.state in ('PUBLISHED_VERIFIED','PUBLISHED_MANUAL')`,
    sql`coalesce(r.published_at, r.created_at) >= ${from.toISOString()}::timestamptz`,
    sql`coalesce(r.published_at, r.created_at) < ${to.toISOString()}::timestamptz`,
  ];
  if (q.socialAccountId) where.push(sql`r.social_account_id = ${q.socialAccountId}`);
  if (q.platform) where.push(sql`sa.platform = ${q.platform.toLowerCase()}::platform`);
  if (q.brandId) where.push(sql`c.brand_id = ${q.brandId}`);
  if (q.song) where.push(sql`(r.title ilike ${'%' + q.song + '%'} or p.title ilike ${'%' + q.song + '%'})`);
  if (q.contentType) where.push(sql`coalesce(r.provider_meta->>'mediaType', r.provider_meta->>'media_type', '') = ${q.contentType}`);
  if (q.campaignId)
    where.push(
      sql`exists (select 1 from deal_deliverables d where d.publication_id = r.id and d.deal_id = ${q.campaignId})`,
    );

  const posts = rowsOf<{
    id: string;
    title: string | null;
    url: string | null;
    platform: string;
    handle: string;
    publishedAt: string | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    reach: number | null;
    saves: number | null;
    watchTimeSeconds: number | null;
    avgViewPct: number | null;
    provenance: string | null;
    thumb: string | null;
    endpoint: string | null;
    collectedAt: string | null;
    project: string | null;
    mediaKind: string | null;
    note: string | null;
    extra: Record<string, number> | null;
  }>(
    await ctx.db.execute(sql`
      select r.id, r.title, r.canonical_url as url, sa.platform::text as platform, sa.handle,
             r.published_at as "publishedAt",
             coalesce((snap.views)::float8, (r.latest_stats->>'views')::float8) as views,
             coalesce((snap.likes)::float8, (r.latest_stats->>'likes')::float8) as likes,
             coalesce((snap.comments)::float8, (r.latest_stats->>'comments')::float8) as comments,
             coalesce((snap.shares)::float8, (r.latest_stats->>'shares')::float8) as shares,
             coalesce((snap.impressions)::float8, (r.latest_stats->>'impressions')::float8) as reach,
             coalesce((snap.saves)::float8, (r.latest_stats->>'saves')::float8) as saves,
             coalesce((snap.watch_time_seconds)::float8, (r.latest_stats->>'watchTimeSeconds')::float8) as "watchTimeSeconds",
             coalesce(snap.avg_view_pct, (r.latest_stats->>'avgViewPct')::float8) as "avgViewPct",
             coalesce(snap.provenance::text, r.latest_stats->>'provenance') as provenance,
             coalesce(r.provider_meta->>'thumbnailUrl', r.provider_meta->>'thumbnail_url') as thumb,
             snap.provider_meta->>'endpoint' as endpoint,
             snap.provider_meta->>'mediaKind' as "mediaKind",
             snap.provider_meta->>'note' as note,
             snap.provider_meta->'metrics' as extra,
             snap.snapshot_at as "collectedAt",
             p.title as project
      from publication_records r
      join social_accounts sa on sa.id = r.social_account_id
      join channels c on c.id = sa.channel_id
      left join distribution_variants v on v.id = r.variant_id
      left join creative_projects p on p.id = v.project_id
      left join lateral (
        select * from publication_metrics_snapshots m
        where m.publication_id = r.id
        order by m.snapshot_at desc
        limit 1
      ) snap on true
      where ${sql.join(where, sql` and `)}
      order by r.published_at desc nulls last
      limit 200`),
  );

  const accounts = rowsOf<{
    id: string;
    platform: string;
    handle: string;
    url: string | null;
    scopes: string[] | null;
    state: string | null;
    expiresAt: string | null;
    lastSync: string | null;
    lastStatus: string | null;
    lastError: string | null;
  }>(
    await ctx.db.execute(sql`
      select a.id, a.platform::text as platform, a.handle, a.profile_url as url,
             c.scopes, c.state, c.expires_at as "expiresAt",
             s.finished_at as "lastSync", s.status as "lastStatus", s.error as "lastError"
      from social_accounts a
      left join provider_connections c on c.id = a.provider_connection_id
      left join lateral (
        select finished_at, status, error from analytics_sync_runs
        where social_account_id = a.id
        order by started_at desc limit 1
      ) s on true
      where a.org_id = ${ctx.orgId} and a.deleted_at is null
      order by a.platform, a.handle`),
  ).map((a) => ({
    ...a,
    capabilities: connectorCapabilities(a.platform, a.scopes),
    token: !a.expiresAt ? 'unknown' : new Date(a.expiresAt).getTime() < Date.now() ? 'expired' : 'ok',
  }));

  const content = posts.map((p) => {
    const caps = connectorCapabilities(p.platform, accounts.find((a) => a.platform.toLowerCase() === p.platform.toLowerCase())?.scopes);
    const supported = (metric: string) => caps.find((c) => c.metric === metric)?.status === 'AVAILABLE';
    const recorded = (value: number | null) => value !== null && value !== undefined;
    return {
      ...p,
      metrics: {
        views: stateOf(p.views, supported('views') || recorded(p.views), recorded(p.views)),
        likes: stateOf(p.likes, supported('likes') || recorded(p.likes), recorded(p.likes)),
        comments: stateOf(p.comments, supported('comments') || recorded(p.comments), recorded(p.comments)),
        shares: stateOf(p.shares, supported('shares') || recorded(p.shares), recorded(p.shares)),
        reach: stateOf(p.reach, supported('reach') || recorded(p.reach), recorded(p.reach)),
        saves: stateOf(p.saves, supported('saves') || recorded(p.saves), recorded(p.saves)),
        watchTime: stateOf(p.watchTimeSeconds, supported('watch_time') || recorded(p.watchTimeSeconds), recorded(p.watchTimeSeconds)),
        avgView: stateOf(p.avgViewPct, supported('avg_view') || recorded(p.avgViewPct), recorded(p.avgViewPct)),
      },
      details: numberMap(p.extra),
      provenance: p.provenance ?? 'UNKNOWN',
    };
  });

  const byDay: Record<string, { posts: number; views: number | null }> = {};
  for (const p of content) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(p.publishedAt ?? from.toISOString()),
    );
    const slot = (byDay[day] ??= { posts: 0, views: null });
    slot.posts += 1;
    if (p.metrics.views.value != null) slot.views = (slot.views ?? 0) + p.metrics.views.value;
  }

  const followers = rowsOf<{
    accountId: string;
    metric: string;
    value: number | null;
    state: string;
    collectedAt: string;
    reportingOn: string | null;
    endpoint: string | null;
    detail: { dimension: string; label: string; value: number }[] | null;
  }>(
    await ctx.db.execute(sql`
      select social_account_id as "accountId", metric, value, state, collected_at as "collectedAt",
             reporting_on as "reportingOn", endpoint, detail
      from account_metric_snapshots
      where org_id = ${ctx.orgId}
      order by collected_at asc`),
  );

  return {
    timezone: tz,
    range: { from: from.toISOString(), to: to.toISOString() },
    content,
    byDay: Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({ day, ...v })),
    accounts,
    followers,
    notes: [
      'Views, likes and comments on a post are the latest stored lifetime totals, not gains on that calendar day.',
      'YouTube watch time, period views and average view length cover the last 28 days ending two days ago. Instagram account totals use the last 28 days Instagram reports.',
      'A photo has no Instagram views metric. Reach, saves and likes are still stored when Instagram returns them.',
      'Reach and follower counts stay on their own account. They are not added across platforms.',
    ],
  };
}
