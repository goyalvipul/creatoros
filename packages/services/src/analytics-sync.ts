import { and, eq, providerConnections, sql } from '@creatoros/db';
import {
  ConnectorError,
  YouTubeConnector,
  fetchFacebookAudience,
  fetchFacebookPageFollows,
  fetchFacebookPageMetrics,
  fetchFacebookPostEngagement,
  fetchFacebookPostInsights,
  fetchInstagramAccountWindow,
  fetchInstagramDemographics,
  fetchInstagramFollowerSeries,
  fetchInstagramMediaRecord,
  fetchInstagramProfile,
  fetchThreadsFollowers,
  fetchThreadsMediaInsights,
  indexYoutubeByVideo,
  youtubeChannelRow,
  fetchYoutubeAnalyticsReport,
  youtubeDemographicSlices,
  youtubeMinutesWatched,
  type DemographicSlice,
} from '@creatoros/connectors';
import { classifyMetric, connectorCapabilities } from '@creatoros/domain';
import { connectorContext } from './integrations';
import type { Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const yt = new YouTubeConnector();

function redact(message: string) {
  return message.replace(/access_token=[^&\s]+/gi, 'access_token=redacted').replace(/Bearer\s+\S+/gi, 'Bearer redacted').slice(0, 300);
}

async function writeContent(
  ctx: Ctx,
  publicationId: string,
  metrics: {
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    impressions?: number | null;
    watchTimeSeconds?: number | null;
    avgViewPct?: number | null;
    followersGained?: number | null;
  },
  endpoint: string,
  extra: Record<string, number | null | undefined> = {},
  info: { mediaKind?: string | null; note?: string | null } = {},
) {
  const now = ctx.now().toISOString();
  const details: Record<string, number> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'number' && Number.isFinite(value)) details[key] = value;
  }
  const patch: Record<string, unknown> = { provenance: 'VERIFIED_PLATFORM', at: now, endpoint };
  const columns = {
    views: metrics.views,
    watchTimeSeconds: metrics.watchTimeSeconds,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    saves: metrics.saves,
    impressions: metrics.impressions,
    avgViewPct: metrics.avgViewPct,
    followersGained: metrics.followersGained,
  };
  for (const [key, value] of Object.entries(columns)) {
    if (typeof value === 'number' && Number.isFinite(value)) patch[key] = value;
  }
  for (const [key, value] of Object.entries(details)) patch[key] = value;
  const meta = { endpoint, mediaKind: info.mediaKind ?? null, note: info.note ?? null, metrics: details };
  await ctx.db.execute(sql`
    insert into publication_metrics_snapshots
      (org_id, publication_id, snapshot_at, views, watch_time_seconds, likes, comments, shares, saves, impressions,
       followers_gained, avg_view_pct, provenance, provider_meta)
    values (
      ${ctx.orgId}, ${publicationId}, ${now}::timestamptz,
      ${metrics.views ?? null}, ${metrics.watchTimeSeconds ?? null}, ${metrics.likes ?? null}, ${metrics.comments ?? null},
      ${metrics.shares ?? null}, ${metrics.saves ?? null}, ${metrics.impressions ?? null},
      ${metrics.followersGained ?? null}, ${metrics.avgViewPct ?? null},
      'VERIFIED_PLATFORM', ${JSON.stringify(meta)}::jsonb
    )`);
  await ctx.db.execute(sql`
    update publication_records
    set latest_stats = coalesce(latest_stats, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
        updated_at = now()
    where id = ${publicationId} and org_id = ${ctx.orgId}`);
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function writeAccount(
  ctx: Ctx,
  accountId: string,
  platform: string,
  metric: string,
  raw: number | null | undefined,
  supported: boolean,
  endpoint: string,
  definition: string,
  reportingOn?: string | null,
  detail?: DemographicSlice[] | null,
) {
  const classified = classifyMetric(raw ?? null, supported);
  const state = detail && detail.length > 0 ? 'VALUE' : classified.state;
  await ctx.db.execute(sql`
    insert into account_metric_snapshots
      (org_id, social_account_id, platform, metric, value, state, reporting_on, endpoint, definition, provenance, detail)
    values (
      ${ctx.orgId}, ${accountId}, ${platform}, ${metric}, ${classified.value}, ${state},
      ${reportingOn ?? null}::date, ${endpoint}, ${definition}, 'VERIFIED_PLATFORM',
      ${detail && detail.length ? JSON.stringify(detail) : null}::jsonb
    )`);
}

function reportWindow(nowMs: number) {
  const day = 24 * 3600_000;
  const end = new Date(nowMs - 2 * day).toISOString().slice(0, 10);
  const start = new Date(nowMs - 30 * day).toISOString().slice(0, 10);
  return { start, end };
}

export async function syncAnalytics(
  ctx: Ctx,
  opts: { socialAccountId?: string; force?: boolean; scheduled?: boolean } = {},
) {
  const minAgeMs = opts.scheduled ? 20 * 3600_000 : 15 * 60_000;
  const accounts = rowsOf<{
    id: string;
    platform: string;
    connId: string | null;
    principal: string | null;
    externalIds: string[] | null;
  }>(
    await ctx.db.execute(sql`
      select a.id, a.platform::text as platform, a.provider_connection_id as "connId",
             c.principal_hint as principal,
             (select array_agg(r.external_post_id) from publication_records r
               where r.social_account_id = a.id and r.external_post_id is not null) as "externalIds"
      from social_accounts a
      left join provider_connections c on c.id = a.provider_connection_id
      where a.org_id = ${ctx.orgId} and a.deleted_at is null
        and (${opts.socialAccountId ?? null}::uuid is null or a.id = ${opts.socialAccountId ?? null}::uuid)`),
  );
  const results: { accountId: string; status: string; error?: string; updated?: number }[] = [];
  for (const account of accounts) {
    const recent = rowsOf<{ age: number; status: string }>(
      await ctx.db.execute(sql`
        select extract(epoch from (now() - started_at)) * 1000 as age, status
        from analytics_sync_runs
        where social_account_id = ${account.id}
        order by started_at desc limit 1`),
    )[0];
    if (!opts.force && recent && recent.status === 'OK' && recent.age < minAgeMs) {
      results.push({ accountId: account.id, status: 'SKIPPED' });
      continue;
    }
    if (recent?.status === 'RUNNING' && recent.age < 15 * 60_000) {
      results.push({ accountId: account.id, status: 'BUSY' });
      continue;
    }
    const [run] = rowsOf<{ id: string }>(
      await ctx.db.execute(sql`
        insert into analytics_sync_runs (org_id, social_account_id, platform, status)
        values (${ctx.orgId}, ${account.id}, ${account.platform}, 'RUNNING')
        returning id`),
    );
    try {
      const outcome = await syncOne(ctx, account);
      const missed = outcome.missed
        ? `${outcome.missed} posts were not returned by the platform.`
        : null;
      await ctx.db.execute(sql`
        update analytics_sync_runs set status = 'OK', finished_at = now(), error = ${missed},
          stats = ${JSON.stringify({ updated: outcome.updated, missed: outcome.missed })}::jsonb
        where id = ${run!.id}`);
      results.push({ accountId: account.id, status: 'OK', updated: outcome.updated, error: missed ?? undefined });
    } catch (e) {
      const error = redact((e as Error).message || 'Sync failed');
      await ctx.db.execute(sql`
        update analytics_sync_runs set status = 'FAILED', finished_at = now(), error = ${error}
        where id = ${run!.id}`);
      results.push({ accountId: account.id, status: 'FAILED', error });
    }
  }
  return { results };
}

async function syncOne(
  ctx: Ctx,
  account: { id: string; platform: string; connId: string | null; principal: string | null; externalIds: string[] | null },
) {
  if (!account.connId) return { updated: 0, missed: 0 };
  const [conn] = await ctx.db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, account.connId), eq(providerConnections.orgId, ctx.orgId)));
  if (!conn || (conn.state !== 'ACTIVE' && conn.state !== 'PARTIAL_SYNC')) return { updated: 0, missed: 0 };
  const caps = connectorCapabilities(account.platform, conn.scopes);
  const available = (metric: string) => caps.find((c) => c.metric === metric)?.status === 'AVAILABLE';
  const cctx = connectorContext(ctx.db, ctx.env, conn);
  const ids = account.externalIds ?? [];
  let updated = 0;
  let missed = 0;
  const platform = account.platform.toUpperCase();

  if (platform === 'YOUTUBE') {
    if (available('subscribers')) {
      const stats = await yt.channelStatistics(cctx);
      await writeAccount(
        ctx,
        account.id,
        platform,
        'subscribers',
        stats.hidden ? null : stats.subscribers,
        !stats.hidden && stats.subscribers != null,
        'youtube/v3/channels statistics.subscriberCount',
        'Current subscriber count.',
      );
    }
    const window = reportWindow(ctx.now().getTime());
    const period = `from ${window.start} to ${window.end}. This is not a lifetime total.`;
    let videoAnalytics = new Map<string, Record<string, number>>();
    if (available('watch_time')) {
      const rich = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost';
      try {
        const channel = youtubeChannelRow(
          await fetchYoutubeAnalyticsReport(cctx, { startDate: window.start, endDate: window.end, metrics: rich }),
        );
        await writeAccount(ctx, account.id, platform, 'watch_time', channel.estimatedMinutesWatched ?? null, channel.estimatedMinutesWatched != null, 'youtubeAnalytics/v2 reports', `Minutes watched ${period}`, window.end);
        await writeAccount(ctx, account.id, platform, 'views_period', channel.views ?? null, channel.views != null, 'youtubeAnalytics/v2 reports views', `Views ${period}`, window.end);
        await writeAccount(ctx, account.id, platform, 'subscribers_gained', channel.subscribersGained ?? null, channel.subscribersGained != null, 'youtubeAnalytics/v2 reports subscribersGained', `Subscribers gained ${period}`, window.end);
        await writeAccount(ctx, account.id, platform, 'subscribers_lost', channel.subscribersLost ?? null, channel.subscribersLost != null, 'youtubeAnalytics/v2 reports subscribersLost', `Subscribers lost ${period}`, window.end);
        await writeAccount(ctx, account.id, platform, 'avg_view_duration', channel.averageViewDuration ?? null, channel.averageViewDuration != null, 'youtubeAnalytics/v2 reports averageViewDuration', `Average view duration in seconds ${period}`, window.end);
        await writeAccount(ctx, account.id, platform, 'shares_period', channel.shares ?? null, channel.shares != null, 'youtubeAnalytics/v2 reports shares', `Shares ${period}`, window.end);
        videoAnalytics = indexYoutubeByVideo(
          await fetchYoutubeAnalyticsReport(cctx, {
            startDate: window.start,
            endDate: window.end,
            metrics: rich,
            dimensions: 'video',
            maxResults: '200',
            sort: '-views',
          }),
        );
        try {
          const shown = indexYoutubeByVideo(
            await fetchYoutubeAnalyticsReport(cctx, {
              startDate: window.start,
              endDate: window.end,
              metrics: 'impressions,impressionClickThroughRate',
              dimensions: 'video',
              maxResults: '200',
            }),
          );
          for (const [id, row] of shown) videoAnalytics.set(id, { ...(videoAnalytics.get(id) ?? {}), ...row });
          const channelShown = youtubeChannelRow(
            await fetchYoutubeAnalyticsReport(cctx, {
              startDate: window.start,
              endDate: window.end,
              metrics: 'impressions',
            }),
          );
          if (channelShown.impressions != null)
            await writeAccount(ctx, account.id, platform, 'impressions_period', channelShown.impressions, true, 'youtubeAnalytics/v2 reports impressions', `Thumbnail impressions ${period} YouTube only returns this for channels that have it.`, window.end);
        } catch (e) {
          if (!(e instanceof ConnectorError)) throw e;
        }
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        try {
          const rows = await fetchYoutubeAnalyticsReport(cctx, {
            startDate: window.start,
            endDate: window.end,
            metrics: 'estimatedMinutesWatched',
          });
          await writeAccount(ctx, account.id, platform, 'watch_time', youtubeMinutesWatched(rows), true, 'youtubeAnalytics/v2 reports estimatedMinutesWatched', `Minutes watched ${period}`, window.end);
          const byVideo = await fetchYoutubeAnalyticsReport(cctx, {
            startDate: window.start,
            endDate: window.end,
            metrics: 'estimatedMinutesWatched',
            dimensions: 'video',
            maxResults: '200',
          });
          videoAnalytics = indexYoutubeByVideo(byVideo);
        } catch (err) {
          if (!(err instanceof ConnectorError)) throw err;
          await writeAccount(ctx, account.id, platform, 'watch_time', null, false, 'youtubeAnalytics/v2', redact(err.message));
        }
      }
    } else {
      await writeAccount(ctx, account.id, platform, 'watch_time', null, false, 'youtubeAnalytics/v2', 'Needs yt-analytics.readonly. Reconnect YouTube and check that permission.');
    }
    if (available('demographics')) {
      try {
        const rows = await fetchYoutubeAnalyticsReport(cctx, {
          startDate: window.start,
          endDate: window.end,
          metrics: 'viewerPercentage',
          dimensions: 'ageGroup,gender',
        });
        const slices = youtubeDemographicSlices(rows);
        await writeAccount(
          ctx,
          account.id,
          platform,
          'demographics',
          null,
          slices.length > 0,
          'youtubeAnalytics/v2 demographics',
          slices.length
            ? `Viewer percentage by age and gender from ${window.start} to ${window.end}. Percentages are not added to follower counts.`
            : 'YouTube returned no age and gender rows for this period.',
          window.end,
          slices,
        );
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        await writeAccount(ctx, account.id, platform, 'demographics', null, false, 'youtubeAnalytics/v2 demographics', redact(e.message));
      }
    }
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const posts = await yt.refreshStats(cctx, chunk);
      for (const post of posts) {
        const pub = rowsOf<{ id: string }>(
          await ctx.db.execute(sql`
            select id from publication_records
            where org_id = ${ctx.orgId} and social_account_id = ${account.id} and external_post_id = ${post.externalId}`),
        )[0];
        if (!pub || !post.stats) continue;
        const row = videoAnalytics.get(post.externalId) ?? {};
        const clickRate = typeof row.impressionClickThroughRate === 'number' ? row.impressionClickThroughRate * 100 : null;
        await writeContent(
          ctx,
          pub.id,
          {
            views: post.stats.views ?? null,
            likes: post.stats.likes ?? null,
            comments: post.stats.comments ?? null,
            shares: row.shares ?? null,
            watchTimeSeconds: typeof row.estimatedMinutesWatched === 'number' ? Math.round(row.estimatedMinutesWatched * 60) : null,
            avgViewPct: row.averageViewPercentage ?? null,
            followersGained: row.subscribersGained ?? null,
          },
          'youtube/v3/videos statistics + youtubeAnalytics/v2',
          {
            totalWatchSeconds: typeof row.estimatedMinutesWatched === 'number' ? Math.round(row.estimatedMinutesWatched * 60) : null,
            periodViews: row.views,
            periodLikes: row.likes,
            periodComments: row.comments,
            periodShares: row.shares,
            subscribersGained: row.subscribersGained,
            subscribersLost: row.subscribersLost,
            averageViewDurationSeconds: row.averageViewDuration,
            averageViewPercentage: row.averageViewPercentage,
            impressions: row.impressions,
            impressionClickPercentage: clickRate,
          },
        );
        updated += 1;
      }
    }
    return { updated, missed };
  }

  if (platform === 'INSTAGRAM') {
    if (available('followers')) {
      try {
        const series = await fetchInstagramFollowerSeries(cctx);
        if (series.days.length === 0) {
          const profile = await fetchInstagramProfile(cctx);
          await writeAccount(ctx, account.id, platform, 'followers', profile.followersCount, profile.followersCount != null, 'graph.instagram.com/me followers_count', 'Current follower count from the profile.');
        }
        for (const day of series.days)
          await writeAccount(ctx, account.id, platform, 'followers', day.value, true, 'graph.instagram.com/me/insights follower_count', 'Daily follower total returned by Instagram.', day.date);
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        await writeAccount(ctx, account.id, platform, 'followers', null, false, 'graph.instagram.com/me/insights', redact(e.message));
      }
    } else {
      await writeAccount(ctx, account.id, platform, 'followers', null, false, 'graph.instagram.com/me/insights', 'instagram_business_manage_insights is not granted.');
    }
    if (available('demographics')) {
      try {
        const slices = await fetchInstagramDemographics(cctx);
        await writeAccount(
          ctx,
          account.id,
          platform,
          'demographics',
          null,
          slices.length > 0,
          'graph.instagram.com/me/insights metric=follower_demographics',
          slices.length
            ? 'Follower age, gender and country for this month. Instagram omits a breakdown when the audience is too small.'
            : 'Instagram returned no demographic breakdown. The account may be below the minimum size.',
          null,
          slices,
        );
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        await writeAccount(ctx, account.id, platform, 'demographics', null, false, 'graph.instagram.com/me/insights metric=follower_demographics', redact(e.message));
      }
    }
    if (available('reach')) {
      try {
        const window = await fetchInstagramAccountWindow(cctx);
        const accountMetrics: [string, number | null | undefined, string][] = [
          ['reach_28d', window.reach, 'Accounts reached in the last 28 days Instagram reports. Not a lifetime total.'],
          ['views_28d', window.views, 'Views in the last 28 days Instagram reports. Not a lifetime total.'],
          ['accounts_engaged_28d', window.accounts_engaged, 'Accounts that interacted in the last 28 days Instagram reports.'],
          ['interactions_28d', window.total_interactions, 'Interactions in the last 28 days Instagram reports.'],
        ];
        for (const [metric, value, definition] of accountMetrics) {
          await writeAccount(ctx, account.id, platform, metric, value ?? null, value != null, 'graph.instagram.com/me/insights period=days_28', definition);
        }
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        await writeAccount(ctx, account.id, platform, 'reach_28d', null, false, 'graph.instagram.com/me/insights period=days_28', redact(e.message));
      }
    }
    if (!available('views') && !available('likes')) return { updated, missed };
    await mapPool(ids, 4, async (externalId) => {
      const pub = rowsOf<{ id: string }>(
        await ctx.db.execute(sql`
          select id from publication_records
          where org_id = ${ctx.orgId} and social_account_id = ${account.id} and external_post_id = ${externalId}`),
      )[0];
      if (!pub) return;
      try {
        const record = await fetchInstagramMediaRecord(cctx, externalId, { insights: available('views') });
        const insight = record.insights;
        const avgMs = insight.ig_reels_avg_watch_time;
        const totalMs = insight.ig_reels_video_view_total_time;
        await writeContent(
          ctx,
          pub.id,
          {
            views: insight.views ?? null,
            likes: record.likes ?? insight.likes ?? null,
            comments: record.comments ?? insight.comments ?? null,
            shares: insight.shares ?? null,
            saves: insight.saved ?? null,
            impressions: insight.reach ?? null,
            watchTimeSeconds: typeof totalMs === 'number' ? Math.round(totalMs / 1000) : null,
          },
          'graph.instagram.com media + /insights',
          {
            reach: insight.reach,
            saves: insight.saved,
            shares: insight.shares,
            totalInteractions: insight.total_interactions,
            follows: insight.follows,
            profileVisits: insight.profile_visits,
            profileActivity: insight.profile_activity,
            replies: insight.replies,
            avgWatchSeconds: typeof avgMs === 'number' ? Math.round(avgMs / 1000) : null,
            totalWatchSeconds: typeof totalMs === 'number' ? Math.round(totalMs / 1000) : null,
          },
          { mediaKind: record.productType ?? record.mediaType, note: record.insightNote },
        );
        updated += 1;
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        missed += 1;
      }
    });
    return { updated, missed };
  }

  if (platform === 'FACEBOOK') {
    if (available('followers') && account.principal) {
      try {
        const follows = await fetchFacebookPageFollows(cctx, account.principal);
        await writeAccount(
          ctx,
          account.id,
          platform,
          'followers',
          follows,
          follows != null,
          'graph.facebook.com/{page-id}/insights metric=page_follows',
          'Latest daily Page follows.',
        );
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        await writeAccount(ctx, account.id, platform, 'followers', null, false, 'graph.facebook.com/{page-id}/insights metric=page_follows', redact(e.message));
      }
    } else if (!available('followers')) {
      await writeAccount(ctx, account.id, platform, 'followers', null, false, 'graph.facebook.com/{page-id}/insights metric=page_follows', 'Needs read_insights. Reconnect Facebook and check that permission.');
    }
    if (available('views') && account.principal) {
      const page = await fetchFacebookPageMetrics(cctx, account.principal);
      const pageMetrics: [string, number | null | undefined, string, string][] = [
        ['page_media_views', page.page_media_view, 'graph.facebook.com/{page-id}/insights metric=page_media_view', 'Page media views for the latest day Facebook returned.'],
        ['page_engagements', page.page_post_engagements, 'graph.facebook.com/{page-id}/insights metric=page_post_engagements', 'Page post engagements for the latest day Facebook returned.'],
        ['page_views', page.page_views_total, 'graph.facebook.com/{page-id}/insights metric=page_views_total', 'Page views for the latest day Facebook returned.'],
      ];
      for (const [metric, value, endpoint, definition] of pageMetrics) {
        if (value == null) continue;
        await writeAccount(ctx, account.id, platform, metric, value, true, endpoint, definition);
      }
    }
    if (available('demographics') && account.principal) {
      try {
        const slices = await fetchFacebookAudience(cctx, account.principal);
        await writeAccount(
          ctx,
          account.id,
          platform,
          'demographics',
          null,
          slices.length > 0,
          'graph.facebook.com/{page-id}/insights page_follows_country,page_follows_city',
          slices.length ? 'Page follows by country and city.' : 'Facebook returned no country or city breakdown.',
          null,
          slices,
        );
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        await writeAccount(ctx, account.id, platform, 'demographics', null, false, 'graph.facebook.com page insights', redact(e.message));
      }
    }
    if (!available('reactions') && !available('views')) return { updated, missed };
    for (const externalId of ids) {
      const pub = rowsOf<{ id: string }>(
        await ctx.db.execute(sql`
          select id from publication_records
          where org_id = ${ctx.orgId} and social_account_id = ${account.id} and external_post_id = ${externalId}`),
      )[0];
      if (!pub) continue;
      try {
        const post = available('reactions') ? await fetchFacebookPostEngagement(cctx, externalId) : null;
        let insight: Record<string, number | null> = {};
        let note: string | null = null;
        if (available('views')) {
          try {
            insight = await fetchFacebookPostInsights(cctx, externalId);
          } catch (e) {
            if (!(e instanceof ConnectorError)) throw e;
            note = redact(e.message);
          }
        }
        const avgMs = insight.post_video_avg_time_watched;
        await writeContent(
          ctx,
          pub.id,
          {
            likes: post?.reactions ?? null,
            comments: post?.comments ?? null,
            shares: post?.shares ?? null,
            views: insight.post_media_view ?? insight.post_video_views ?? null,
            watchTimeSeconds: typeof avgMs === 'number' ? Math.round(avgMs / 1000) : null,
          },
          'graph.facebook.com/{post-id} engagement + insights',
          {
            clicks: insight.post_clicks,
            videoViews: insight.post_video_views,
            avgWatchSeconds: typeof avgMs === 'number' ? Math.round(avgMs / 1000) : null,
            reactionLike: insight.reactionLike,
            reactionLove: insight.reactionLove,
            reactionCare: insight.reactionCare,
            reactionWow: insight.reactionWow,
            reactionHaha: insight.reactionHaha,
            reactionSorry: insight.reactionSorry,
            reactionAnger: insight.reactionAnger,
          },
          { note },
        );
        updated += 1;
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        missed += 1;
      }
    }
    return { updated, missed };
  }

  if (platform === 'THREADS') {
    if (available('followers')) {
      try {
        const followers = await fetchThreadsFollowers(cctx);
        await writeAccount(
          ctx,
          account.id,
          platform,
          'followers',
          followers,
          followers != null,
          'graph.threads.net/me/threads_insights metric=followers_count',
          'Current Threads follower count.',
        );
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        await writeAccount(ctx, account.id, platform, 'followers', null, false, 'graph.threads.net/me/threads_insights', redact(e.message));
      }
    } else {
      await writeAccount(ctx, account.id, platform, 'followers', null, false, 'graph.threads.net/me/threads_insights', 'Needs threads_manage_insights. Reconnect Threads and allow insights.');
    }
    if (!available('views')) return { updated, missed };
    await mapPool(ids, 4, async (externalId) => {
      const pub = rowsOf<{ id: string }>(
        await ctx.db.execute(sql`
          select id from publication_records
          where org_id = ${ctx.orgId} and social_account_id = ${account.id} and external_post_id = ${externalId}`),
      )[0];
      if (!pub) return;
      try {
        const insight = await fetchThreadsMediaInsights(cctx, externalId);
        await writeContent(
          ctx,
          pub.id,
          {
            views: insight.views ?? null,
            likes: insight.likes ?? null,
            comments: insight.replies ?? null,
            shares: insight.shares ?? null,
          },
          'graph.threads.net/{media-id}/insights',
          { replies: insight.replies, reposts: insight.reposts, quotes: insight.quotes, shares: insight.shares },
        );
        updated += 1;
      } catch (e) {
        if (!(e instanceof ConnectorError)) throw e;
        missed += 1;
      }
    });
    return { updated, missed };
  }

  return { updated, missed };
}
