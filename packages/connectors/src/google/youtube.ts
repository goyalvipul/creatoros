import {
  ConnectorError,
  type Connector,
  type ConnectorCapabilities,
  type ConnectorContext,
  type ConnectResult,
  type Credentials,
  type HealthResult,
  type NormalizedPost,
  type RateLimitBudget,
  type SyncResult,
} from '../types';
import { ensureFreshToken, http } from '../http';
import {
  buildGoogleAuthUrl,
  GOOGLE_SCOPES,
  hasScope,
  refreshGoogleToken,
  revokeGoogleToken,
  type GoogleClientConfig,
} from './oauth';
import { generatePkce, randomState } from '../pkce';

const API = 'https://www.googleapis.com/youtube/v3';

interface YtVideo {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
    thumbnails?: Record<string, { url: string }>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  status?: { privacyStatus?: 'public' | 'unlisted' | 'private'; uploadStatus?: string; publishAt?: string };
}

export function parseIsoDurationMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, mi, s] = m;
  return Math.round(
    ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0)) * 1000,
  );
}

/** YouTube Data API v3 quota is 10,000 units/day by default; list calls cost 1 unit each. We estimate usage locally. */
const quotaUsed = new Map<string, { day: string; units: number }>();
function trackQuota(principal: string, units: number, now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  const cur = quotaUsed.get(principal);
  if (!cur || cur.day !== day) quotaUsed.set(principal, { day, units });
  else cur.units += units;
}

export class YouTubeConnector implements Connector<NormalizedPost, YtVideo> {
  readonly id = 'youtube' as const;

  async getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const client = ctx.config.googleClient as GoogleClientConfig | undefined;
    const creds = ctx.credentials;
    const hasTokens = Boolean(creds.refreshToken || creds.accessToken);
    const read = hasTokens && hasScope(creds, GOOGLE_SCOPES.youtubeRead[0]);
    const analytics = hasTokens && hasScope(creds, GOOGLE_SCOPES.youtubeAnalytics[0]);
    const comments = hasTokens && hasScope(creds, GOOGLE_SCOPES.youtubeComments[0]);
    const blockers: string[] = [];
    if (!client)
      blockers.push('Google OAuth client is not configured (GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URI).');
    if (client && !hasTokens) blockers.push('YouTube channel not connected yet.');
    blockers.push(
      'Uploading videos via API is not implemented (read-only import). Publish on YouTube Studio and record/import the result.',
    );
    return {
      provider: 'youtube',
      state: !client || !hasTokens ? 'NOT_CONFIGURED' : 'ACTIVE',
      read,
      write: false,
      incrementalSync: read,
      flags: {
        importUploads: read,
        ownStats: read,
        privateAnalytics: analytics,
        comments,
        upload: false,
      },
      blockers,
      setupSteps: [
        'In Google Cloud Console enable "YouTube Data API v3" for the same project as the Gmail client.',
        'Press Connect in Integrations and approve youtube.readonly (optionally yt-analytics.readonly).',
        'Link the connected channel to the matching social account in Channels.',
        'For Socials comments: press Enable comments and approve youtube.force-ssl (read and reply to comments).',
      ],
    };
  }

  async connect(ctx: ConnectorContext, input: Record<string, any> = {}): Promise<ConnectResult> {
    const client = ctx.config.googleClient as GoogleClientConfig | undefined;
    if (!client) return { status: 'NOT_CONFIGURED', steps: (await this.getCapabilities(ctx)).setupSteps };
    const pkce = generatePkce();
    const state = randomState();
    const scopes = [
      ...GOOGLE_SCOPES.identity,
      ...GOOGLE_SCOPES.youtubeRead,
      ...(input.analytics ? GOOGLE_SCOPES.youtubeAnalytics : []),
      ...(input.comments ? GOOGLE_SCOPES.youtubeComments : []),
    ];
    return {
      status: 'REDIRECT',
      authorizeUrl: buildGoogleAuthUrl({
        client,
        scopes,
        state,
        codeChallenge: pkce.challenge,
        loginHint: input.loginHint,
      }),
      oauth: { state, verifier: pkce.verifier, scopes },
    };
  }

  async disconnect(ctx: ConnectorContext): Promise<void> {
    await revokeGoogleToken(ctx);
  }

  refreshCredentials(ctx: ConnectorContext): Promise<Credentials> {
    return refreshGoogleToken(ctx);
  }

  private async get<T>(
    ctx: ConnectorContext,
    path: string,
    query: Record<string, string | number | undefined>,
  ): Promise<T> {
    const token = await ensureFreshToken(ctx, refreshGoogleToken);
    trackQuota(ctx.credentials.principal ?? 'unknown', 1, ctx.now());
    const { data } = await http<T>(ctx, `${API}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      query,
    });
    return data;
  }

  async health(ctx: ConnectorContext): Promise<HealthResult> {
    try {
      await this.get(ctx, '/channels', { part: 'id', mine: 'true' });
      return { ok: true, state: 'ACTIVE', checkedAt: new Date(ctx.now()).toISOString() };
    } catch (e) {
      const err = e as ConnectorError;
      const state =
        err.kind === 'QUOTA_EXCEEDED'
          ? 'PARTIAL_SYNC'
          : err.kind === 'AUTH_REVOKED' || err.kind === 'AUTH_EXPIRED'
            ? 'AUTH_EXPIRED'
            : err.kind === 'NOT_CONFIGURED'
              ? 'NOT_CONFIGURED'
              : 'ERROR';
      return { ok: false, state, detail: err.message, checkedAt: new Date(ctx.now()).toISOString() };
    }
  }

  async rateLimitBudget(ctx: ConnectorContext): Promise<RateLimitBudget> {
    const used = quotaUsed.get(ctx.credentials.principal ?? 'unknown');
    const limit = 10_000;
    return {
      remaining: used ? Math.max(0, limit - used.units) : limit,
      limit,
      resetsAt: nextPacificMidnight(ctx.now()),
      estimated: true,
    };
  }

  normalize(v: YtVideo): NormalizedPost {
    const priv = v.status?.privacyStatus;
    const scheduled = Boolean(v.status?.publishAt && new Date(v.status.publishAt).getTime() > Date.now());
    const th = v.snippet?.thumbnails;
    return {
      provider: 'youtube',
      externalId: v.id,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      title: v.snippet?.title ?? null,
      description: v.snippet?.description ?? null,
      publishedAt: v.snippet?.publishedAt ?? null,
      durationMs: parseIsoDurationMs(v.contentDetails?.duration),
      privacy: scheduled
        ? 'SCHEDULED'
        : priv === 'private'
          ? 'PRIVATE'
          : priv === 'unlisted'
            ? 'UNLISTED'
            : 'PUBLIC',
      state:
        v.status?.uploadStatus === 'failed' || v.status?.uploadStatus === 'rejected'
          ? 'FAILED'
          : v.status?.uploadStatus === 'uploaded'
            ? 'PROCESSING'
            : scheduled
              ? 'SCHEDULED'
              : 'PUBLISHED_VERIFIED',
      stats: v.statistics
        ? {
            views: num(v.statistics.viewCount),
            likes: num(v.statistics.likeCount),
            comments: num(v.statistics.commentCount),
          }
        : null,
      thumbnailUrl: th?.high?.url ?? th?.medium?.url ?? th?.default?.url ?? null,
      accountExternalId: v.snippet?.channelId ?? null,
      raw: undefined,
    };
  }

  async getChannel(
    ctx: ConnectorContext,
  ): Promise<{ channelId: string; title: string; uploadsPlaylistId: string } | null> {
    const res = await this.get<{
      items?: {
        id: string;
        snippet?: { title?: string };
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
      }[];
    }>(ctx, '/channels', { part: 'snippet,contentDetails', mine: 'true' });
    const ch = res.items?.[0];
    if (!ch?.contentDetails?.relatedPlaylists?.uploads) return null;
    return {
      channelId: ch.id,
      title: ch.snippet?.title ?? '',
      uploadsPlaylistId: ch.contentDetails.relatedPlaylists.uploads,
    };
  }

  async getExternalRecord(ctx: ConnectorContext, id: string): Promise<NormalizedPost | null> {
    const items = await this.videosById(ctx, [id]);
    return items[0] ? this.normalize(items[0]) : null;
  }

  private async videosById(ctx: ConnectorContext, ids: string[]): Promise<YtVideo[]> {
    const out: YtVideo[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const res = await this.get<{ items?: YtVideo[] }>(ctx, '/videos', {
        part: 'snippet,contentDetails,statistics,status',
        id: chunk.join(','),
      });
      out.push(...(res.items ?? []));
    }
    return out;
  }

  /**
   * Import uploads via channels -> uploads playlist -> playlistItems (paginated) -> videos.list.
   * `stopAtPublishedAfter` enables the incremental mode: the uploads playlist is newest-first so we can stop early.
   */
  private async importUploads(
    ctx: ConnectorContext,
    opts: { stopBefore?: string | null; maxPages?: number },
  ): Promise<{ posts: NormalizedPost[]; newest: string | null; channelId: string | null }> {
    const channel = await this.getChannel(ctx);
    if (!channel) return { posts: [], newest: null, channelId: null };
    const posts: NormalizedPost[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    let newest: string | null = null;
    let stop = false;
    do {
      const page = await this.get<{
        items?: { contentDetails?: { videoId: string; videoPublishedAt?: string } }[];
        nextPageToken?: string;
      }>(ctx, '/playlistItems', {
        part: 'contentDetails',
        playlistId: channel.uploadsPlaylistId,
        maxResults: 50,
        pageToken,
      });
      const ids: string[] = [];
      for (const it of page.items ?? []) {
        const vid = it.contentDetails?.videoId;
        const pub = it.contentDetails?.videoPublishedAt ?? null;
        if (!vid) continue;
        if (opts.stopBefore && pub && pub <= opts.stopBefore) {
          stop = true;
          continue;
        }
        if (pub && (!newest || pub > newest)) newest = pub;
        ids.push(vid);
      }
      if (ids.length) posts.push(...(await this.videosById(ctx, ids)).map((v) => this.normalize(v)));
      pageToken = stop ? undefined : page.nextPageToken;
      pages += 1;
    } while (pageToken && pages < (opts.maxPages ?? 200));
    return { posts, newest, channelId: channel.channelId };
  }

  async syncFull(ctx: ConnectorContext): Promise<SyncResult<NormalizedPost>> {
    const r = await this.importUploads(ctx, {});
    return { items: r.posts, nextCursor: r.newest, hasMore: false, stats: { videos: r.posts.length } };
  }

  async syncIncremental(ctx: ConnectorContext, cursor: string | null): Promise<SyncResult<NormalizedPost>> {
    if (!cursor) return this.syncFull(ctx);
    const r = await this.importUploads(ctx, { stopBefore: cursor });
    return {
      items: r.posts,
      nextCursor: r.newest ?? cursor,
      hasMore: false,
      stats: { videos: r.posts.length },
    };
  }

  /** Refresh stats for known video ids (quota: 1 unit per 50 videos). */
  async refreshStats(ctx: ConnectorContext, ids: string[]): Promise<NormalizedPost[]> {
    return (await this.videosById(ctx, ids)).map((v) => this.normalize(v));
  }
}

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function nextPacificMidnight(now: number): string {
  // Quota resets at midnight Pacific time.
  const d = new Date(now);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const next = new Date(`${fmt}T00:00:00-08:00`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

// ---------------------------------------------------------------- comments (Socials)

export interface YtComment {
  id: string;
  /** top-level comment id this comment belongs to (the thread) */
  threadId: string;
  videoId: string | null;
  text: string;
  authorName: string | null;
  authorChannelId: string | null;
  publishedAt: string;
  isTopLevel: boolean;
}

export interface YtCommentPage {
  comments: YtComment[];
  nextPageToken: string | null;
}

const toComment = (c: any, threadId: string, videoId: string | null, top: boolean): YtComment => ({
  id: String(c.id),
  threadId,
  videoId: c.snippet?.videoId ?? videoId,
  text: String(c.snippet?.textOriginal ?? c.snippet?.textDisplay ?? ''),
  authorName: c.snippet?.authorDisplayName ?? null,
  authorChannelId: c.snippet?.authorChannelId?.value ?? null,
  publishedAt: String(c.snippet?.publishedAt ?? new Date(0).toISOString()),
  isTopLevel: top,
});

/**
 * One page of comment threads for the whole channel, newest first (1 quota unit). Replies embedded in the thread are
 * included; threads with more replies than embedded are completed with comments.list (1 unit per thread).
 */
export async function listYoutubeCommentPage(
  ctx: ConnectorContext,
  args: { channelId: string; pageToken?: string | null },
): Promise<YtCommentPage> {
  const token = await ensureFreshToken(ctx, refreshGoogleToken);
  trackQuota(ctx.credentials.principal ?? 'unknown', 1, ctx.now());
  const auth = { authorization: `Bearer ${token}` };
  const { data } = await http<any>(ctx, `${API}/commentThreads`, {
    headers: auth,
    query: {
      part: 'snippet,replies',
      allThreadsRelatedToChannelId: args.channelId,
      order: 'time',
      maxResults: 100,
      textFormat: 'plainText',
      pageToken: args.pageToken ?? undefined,
    },
  });
  const out: YtComment[] = [];
  for (const t of data?.items ?? []) {
    const top = t.snippet?.topLevelComment;
    if (!top?.id) continue;
    const videoId = t.snippet?.videoId ?? top.snippet?.videoId ?? null;
    out.push(toComment(top, top.id, videoId, true));
    let replies: any[] = t.replies?.comments ?? [];
    const total = Number(t.snippet?.totalReplyCount ?? 0);
    if (total > replies.length) {
      replies = [];
      let rt: string | undefined;
      for (let i = 0; i < 10; i++) {
        trackQuota(ctx.credentials.principal ?? 'unknown', 1, ctx.now());
        const r = await http<any>(ctx, `${API}/comments`, {
          headers: auth,
          query: {
            part: 'snippet',
            parentId: top.id,
            maxResults: 100,
            textFormat: 'plainText',
            pageToken: rt,
          },
        });
        replies.push(...(r.data?.items ?? []));
        rt = r.data?.nextPageToken;
        if (!rt) break;
      }
    }
    for (const r of replies) out.push(toComment(r, top.id, videoId, false));
  }
  return { comments: out, nextPageToken: data?.nextPageToken ?? null };
}

/** Reply to a top-level comment (YouTube only allows replies to top-level comments). 50 quota units. Never retried. */
export async function replyToYoutubeComment(
  ctx: ConnectorContext,
  args: { parentId: string; text: string },
): Promise<{ providerMessageId: string | null }> {
  const token = await ensureFreshToken(ctx, refreshGoogleToken);
  trackQuota(ctx.credentials.principal ?? 'unknown', 50, ctx.now());
  const { data } = await http<any>(ctx, `${API}/comments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    query: { part: 'snippet' },
    json: { snippet: { parentId: args.parentId, textOriginal: args.text } },
    maxAttempts: 1,
  });
  return { providerMessageId: data?.id ?? null };
}

/** Video titles for a set of ids (1 unit per 50). Used to label comment threads. */
export async function youtubeVideoTitles(
  ctx: ConnectorContext,
  ids: string[],
): Promise<Map<string, { title: string; commentCount: number | null }>> {
  const out = new Map<string, { title: string; commentCount: number | null }>();
  const token = await ensureFreshToken(ctx, refreshGoogleToken);
  for (let i = 0; i < ids.length; i += 50) {
    trackQuota(ctx.credentials.principal ?? 'unknown', 1, ctx.now());
    const { data } = await http<any>(ctx, `${API}/videos`, {
      headers: { authorization: `Bearer ${token}` },
      query: { part: 'snippet,statistics', id: ids.slice(i, i + 50).join(',') },
    });
    for (const v of data?.items ?? [])
      out.set(String(v.id), {
        title: String(v.snippet?.title ?? ''),
        commentCount: num(v.statistics?.commentCount) ?? null,
      });
  }
  return out;
}
