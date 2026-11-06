/** Platform metric rules. A real zero is not the same thing as a metric the API did not return. */

export type MetricState = 'VALUE' | 'ZERO' | 'UNAVAILABLE' | 'UNKNOWN';

export interface ClassifiedMetric {
  state: MetricState;
  value: number | null;
}

export function classifyMetric(raw: number | null | undefined, supported: boolean): ClassifiedMetric {
  if (!supported) return { state: 'UNAVAILABLE', value: null };
  if (raw === undefined || raw === null || Number.isNaN(Number(raw))) return { state: 'UNKNOWN', value: null };
  const n = Number(raw);
  if (n === 0) return { state: 'ZERO', value: 0 };
  return { state: 'VALUE', value: n };
}

export type CapabilityStatus = 'AVAILABLE' | 'MISSING_PERMISSION' | 'UNSUPPORTED' | 'NOT_CONNECTED';

export interface MetricCapability {
  metric: string;
  level: 'account' | 'content';
  additive: boolean;
  status: CapabilityStatus;
  endpoint: string | null;
  definition: string;
  reason: string;
}

const YT_READONLY = 'https://www.googleapis.com/auth/youtube.readonly';
const YT_ANALYTICS = 'https://www.googleapis.com/auth/yt-analytics.readonly';
const IG_BASIC = 'instagram_business_basic';
const IG_INSIGHTS = 'instagram_business_manage_insights';
const FB_ENGAGEMENT = 'pages_read_engagement';
const FB_INSIGHTS = 'read_insights';

function has(scopes: string[] | null | undefined, scope: string) {
  return (scopes ?? []).includes(scope);
}

function row(
  metric: string,
  level: 'account' | 'content',
  additive: boolean,
  status: CapabilityStatus,
  endpoint: string | null,
  definition: string,
  reason: string,
): MetricCapability {
  return { metric, level, additive, status, endpoint, definition, reason };
}

/** What this install can actually ask each platform for. Unsupported stays visible. */
export function connectorCapabilities(platform: string, scopes: string[] | null | undefined): MetricCapability[] {
  const p = platform.toUpperCase();
  if (p === 'YOUTUBE') {
    const stats = has(scopes, YT_READONLY);
    const analytics = has(scopes, YT_ANALYTICS);
    return [
      row('views', 'content', true, stats ? 'AVAILABLE' : 'MISSING_PERMISSION', 'youtube/v3/videos statistics.viewCount', 'Lifetime views on the video.', stats ? 'youtube.readonly is granted.' : 'Needs youtube.readonly.'),
      row('likes', 'content', true, stats ? 'AVAILABLE' : 'MISSING_PERMISSION', 'youtube/v3/videos statistics.likeCount', 'Lifetime likes.', stats ? 'youtube.readonly is granted.' : 'Needs youtube.readonly.'),
      row('comments', 'content', true, stats ? 'AVAILABLE' : 'MISSING_PERMISSION', 'youtube/v3/videos statistics.commentCount', 'Lifetime comments.', stats ? 'youtube.readonly is granted.' : 'Needs youtube.readonly.'),
      row('subscribers', 'account', false, stats ? 'AVAILABLE' : 'MISSING_PERMISSION', 'youtube/v3/channels statistics.subscriberCount', 'Current subscriber count. Hidden counts stay unavailable.', stats ? 'youtube.readonly is granted.' : 'Needs youtube.readonly.'),
      row('watch_time', 'content', true, analytics ? 'AVAILABLE' : 'MISSING_PERMISSION', 'youtubeAnalytics/v2 reports', 'Watch time for the last 28 days ending two days ago. The Data API view count is not watch time.', analytics ? 'yt-analytics.readonly is granted.' : 'Needs yt-analytics.readonly. It is not granted, so watch time stays unavailable.'),
      row('shares', 'content', true, analytics ? 'AVAILABLE' : 'MISSING_PERMISSION', 'youtubeAnalytics/v2 reports shares', 'Shares in that same 28-day window. YouTube does not return lifetime shares on the video.', analytics ? 'yt-analytics.readonly is granted.' : 'Needs yt-analytics.readonly.'),
      row('avg_view', 'content', false, analytics ? 'AVAILABLE' : 'MISSING_PERMISSION', 'youtubeAnalytics/v2 reports averageViewDuration', 'Average view duration and percent viewed in that 28-day window.', analytics ? 'yt-analytics.readonly is granted.' : 'Needs yt-analytics.readonly.'),
      row('demographics', 'account', false, analytics ? 'AVAILABLE' : 'MISSING_PERMISSION', 'youtubeAnalytics/v2 demographics', 'Audience age and gender from YouTube Analytics.', analytics ? 'yt-analytics.readonly is granted.' : 'Needs yt-analytics.readonly.'),
    ];
  }
  if (p === 'INSTAGRAM') {
    const basic = has(scopes, IG_BASIC);
    const insights = has(scopes, IG_INSIGHTS);
    return [
      row('likes', 'content', true, basic ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.instagram.com media like_count', 'Likes on the media object.', basic ? 'instagram_business_basic is granted.' : 'Needs instagram_business_basic.'),
      row('comments', 'content', true, basic ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.instagram.com media comments_count', 'Comments on the media object.', basic ? 'instagram_business_basic is granted.' : 'Needs instagram_business_basic.'),
      row('views', 'content', true, insights ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.instagram.com/{media-id}/insights metric=views', 'Media views from the insights edge. Photos do not have a views metric. The media object does not include views.', insights ? 'instagram_business_manage_insights is granted.' : 'Needs instagram_business_manage_insights.'),
      row('reach', 'content', false, insights ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.instagram.com/{media-id}/insights metric=reach', 'Unique accounts reached. Not added across posts or platforms.', insights ? 'instagram_business_manage_insights is granted.' : 'Needs instagram_business_manage_insights.'),
      row('shares', 'content', true, insights ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.instagram.com/{media-id}/insights metric=shares', 'Shares of the media.', insights ? 'instagram_business_manage_insights is granted.' : 'Needs instagram_business_manage_insights.'),
      row('saves', 'content', true, insights ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.instagram.com/{media-id}/insights metric=saved', 'Saves of the media.', insights ? 'instagram_business_manage_insights is granted.' : 'Needs instagram_business_manage_insights.'),
      row('followers', 'account', false, insights ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.instagram.com/me/insights metric=follower_count', 'Recent daily follower totals returned by the API. Older history is not invented.', insights ? 'instagram_business_manage_insights is granted.' : 'Needs instagram_business_manage_insights.'),
      row('demographics', 'account', false, insights ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.instagram.com/me/insights metric=follower_demographics', 'Follower age, gender and location. Instagram returns this only when the account meets its minimum size.', insights ? 'instagram_business_manage_insights is granted. A missing breakdown stays unavailable.' : 'Needs instagram_business_manage_insights. Reconnect Instagram and check that permission.'),
    ];
  }
  if (p === 'FACEBOOK') {
    const engagement = has(scopes, FB_ENGAGEMENT);
    const insights = has(scopes, FB_INSIGHTS);
    return [
      row('reactions', 'content', true, engagement ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.facebook.com/{post-id} reactions.summary', 'Reactions on the Page post.', engagement ? 'pages_read_engagement is granted.' : 'Needs pages_read_engagement.'),
      row('comments', 'content', true, engagement ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.facebook.com/{post-id} comments.summary', 'Comments on the Page post.', engagement ? 'pages_read_engagement is granted.' : 'Needs pages_read_engagement.'),
      row('shares', 'content', true, engagement ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.facebook.com/{post-id} shares', 'Shares of the Page post.', engagement ? 'pages_read_engagement is granted.' : 'Needs pages_read_engagement.'),
      row('views', 'content', true, insights ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.facebook.com/{post-id}/insights', 'Post or video views. pages_read_engagement does not include them.', insights ? 'read_insights is granted.' : 'Needs read_insights. Reconnect Facebook and check that permission.'),
      row('clicks', 'content', true, insights ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.facebook.com/{post-id}/insights metric=post_clicks', 'Clicks on the Page post.', insights ? 'read_insights is granted.' : 'Needs read_insights. Reconnect Facebook and check that permission.'),
      row('followers', 'account', false, insights ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.facebook.com/{page-id}/insights metric=page_follows', 'Latest daily Page follows. page_fans is no longer returned.', insights ? 'read_insights is granted.' : 'Needs read_insights. Reconnect Facebook and check that permission.'),
      row('demographics', 'account', false, insights ? 'AVAILABLE' : 'MISSING_PERMISSION', 'graph.facebook.com/{page-id}/insights page_follows_country,page_follows_city', 'Where Page followers are, by country and city.', insights ? 'read_insights is granted. A missing breakdown stays unavailable.' : 'Needs read_insights. Reconnect Facebook and check that permission.'),
    ];
  }
  if (p === 'THREADS') {
    const basic = has(scopes, 'threads_basic');
    const insights = has(scopes, 'threads_manage_insights');
    const connected = basic || insights || (scopes ?? []).some((s) => s.startsWith('threads_'));
    const status = (ok: boolean): CapabilityStatus => (!connected ? 'NOT_CONNECTED' : ok ? 'AVAILABLE' : 'MISSING_PERMISSION');
    const why = insights
      ? 'threads_manage_insights is granted.'
      : connected
        ? 'Needs threads_manage_insights. Reconnect Threads and allow insights.'
        : 'Connect Threads under Integrations. Facebook Page permissions do not include Threads.';
    return [
      row('views', 'content', true, status(insights), 'graph.threads.net/{media-id}/insights metric=views', 'Views on a Threads post.', why),
      row('likes', 'content', true, status(insights), 'graph.threads.net/{media-id}/insights metric=likes', 'Likes on a Threads post. The post object does not include them.', why),
      row('comments', 'content', true, status(insights), 'graph.threads.net/{media-id}/insights metric=replies', 'Replies on a Threads post.', why),
      row('shares', 'content', true, status(insights), 'graph.threads.net/{media-id}/insights metric=shares', 'Shares of a Threads post.', why),
      row('followers', 'account', false, status(insights), 'graph.threads.net/me/threads_insights metric=followers_count', 'Current follower count.', why),
    ];
  }
  if (p === 'TIKTOK') {
    return [
      row('views', 'content', true, 'NOT_CONNECTED', null, 'Content views.', 'TikTok has no analytics connector in this install. Nothing is estimated.'),
      row('followers', 'account', false, 'NOT_CONNECTED', null, 'Follower count.', 'No authorised account is connected.'),
    ];
  }
  return [row('views', 'content', true, 'UNSUPPORTED', null, 'Views.', `No analytics connector for ${platform}.`)];
}

export interface Recommendation {
  title: string;
  observed: string;
  hypothesis: string;
  evidence: { publicationId: string; title: string | null; views: number }[];
  sampleSize: number;
  period: { from: string; to: string };
  uncertainty: string;
  action: string;
  metric: string;
  reviewOn: string;
  proven: false;
}

/** Rule-based notes from stored view counts. These are observations, not a claim that a change will work. */
export function ruleRecommendations(
  posts: { id: string; title: string | null; platform: string; views: number | null; publishedAt: string | null }[],
  period: { from: string; to: string },
  now = new Date(),
): Recommendation[] {
  const review = new Date(now.getTime() + 14 * 86400_000).toISOString().slice(0, 10);
  const out: Recommendation[] = [];
  const byPlatform = new Map<string, typeof posts>();
  for (const p of posts) {
    if (p.views == null) continue;
    const list = byPlatform.get(p.platform) ?? [];
    list.push(p);
    byPlatform.set(p.platform, list);
  }
  for (const [platform, list] of byPlatform) {
    if (list.length < 4) continue;
    const sorted = [...list].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
    const top = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 4)));
    const rest = sorted.slice(top.length);
    const avg = (rows: typeof posts) => rows.reduce((s, r) => s + (r.views ?? 0), 0) / rows.length;
    const topAvg = avg(top);
    const restAvg = avg(rest);
    if (!(topAvg > restAvg)) continue;
    out.push({
      title: `${platform} posts with more views`,
      observed: `In this period, the top ${top.length} ${platform} posts average ${Math.round(topAvg).toLocaleString()} views. The other ${rest.length} average ${Math.round(restAvg).toLocaleString()}.`,
      hypothesis: 'The difference may come from topic, length, posting time, or distribution. This is not proof that copying the top posts will raise views.',
      evidence: top.map((p) => ({ publicationId: p.id, title: p.title, views: p.views ?? 0 })),
      sampleSize: list.length,
      period,
      uncertainty: `Sample is ${list.length} posts on one platform. Views are lifetime totals recorded at sync, not views gained inside the period.`,
      action: 'Pick one difference you can control, publish a small set the same way, and compare that metric on the review date.',
      metric: 'views',
      reviewOn: review,
      proven: false,
    });
  }
  return out;
}

export interface PublicKit {
  artistName: string;
  positioning: string;
  bio: string;
  photos: { url: string; alt: string }[];
  platforms: {
    platform: string;
    handle: string;
    url: string | null;
    followers: number | null;
    followersState: MetricState;
    source: string | null;
    updatedAt: string | null;
  }[];
  topContent: { title: string | null; platform: string; url: string | null; views: number; provenance: string }[];
  collaborations: { name: string; note: string }[];
  contact: { email: string | null };
  period: { label: string };
  updatedAt: string | null;
  sources: string[];
}

const SECRET = /token|secret|password|credential|scope/i;

/** Owner copy plus server-filled metrics. Client-supplied follower numbers are ignored. */
export function buildPublicProjection(input: {
  artistName: string;
  positioning: string;
  bio: string;
  photos: { url: string; alt: string }[];
  showFollowers: boolean;
  showTopContent: boolean;
  platforms: { platform: string; handle: string; url: string | null; followers: ClassifiedMetric; source: string | null; updatedAt: string | null }[];
  topContent: { title: string | null; platform: string; url: string | null; views: number; provenance: string }[];
  collaborations: { name: string; note: string }[];
  contactEmail: string | null;
  periodLabel: string;
  updatedAt: string | null;
}): PublicKit {
  return {
    artistName: input.artistName,
    positioning: input.positioning,
    bio: input.bio,
    photos: input.photos.filter((p) => /^https:\/\//.test(p.url)).slice(0, 8),
    platforms: input.platforms.map((p) => ({
      platform: p.platform,
      handle: p.handle,
      url: p.url,
      followers: input.showFollowers && (p.followers.state === 'VALUE' || p.followers.state === 'ZERO') ? p.followers.value : null,
      followersState: input.showFollowers ? p.followers.state : 'UNAVAILABLE',
      source: input.showFollowers ? p.source : null,
      updatedAt: input.showFollowers ? p.updatedAt : null,
    })),
    topContent: input.showTopContent ? input.topContent.slice(0, 6) : [],
    collaborations: input.collaborations.filter((c) => c.name.trim()).slice(0, 12),
    contact: { email: input.contactEmail },
    period: { label: input.periodLabel },
    updatedAt: input.updatedAt,
    sources: ['Verified figures come only from stored platform snapshots. Missing figures are omitted or marked unavailable.'],
  };
}

export function projectionHasSecrets(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET.test(k)) return true;
    if (projectionHasSecrets(v)) return true;
  }
  return false;
}
