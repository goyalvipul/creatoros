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
} from './types';
import { http } from './http';
import { generatePkce, randomState } from './pkce';
import type { Provider } from '@creatoros/domain';

const iso = (ctx: ConnectorContext) => new Date(ctx.now()).toISOString();

/* ---------------------------------------------------------------- Postiz (optional, read-only) */

interface PostizPost {
  id: string;
  publishDate?: string;
  state?: string;
  content?: string;
  releaseURL?: string;
  releaseId?: string;
  integration?: { id?: string; name?: string; providerIdentifier?: string };
}

/**
 * Optional Postiz adapter. READ-ONLY: it imports scheduled/published posts and never schedules on its own. The
 * endpoint paths are configurable because they must be verified against the installed Postiz version.
 */
export class PostizConnector implements Connector<NormalizedPost, PostizPost> {
  readonly id = 'postiz' as const;

  private base(ctx: ConnectorContext): string {
    const b = ctx.config.baseUrl as string | undefined;
    if (!b) throw new ConnectorError('NOT_CONFIGURED', 'Postiz base URL not configured (POSTIZ_BASE_URL).');
    return b.replace(/\/+$/, '');
  }
  private headers(ctx: ConnectorContext) {
    const key = ctx.credentials.apiKey;
    if (!key) throw new ConnectorError('NOT_CONFIGURED', 'Postiz API key not configured (POSTIZ_API_KEY).');
    return { authorization: key, accept: 'application/json' };
  }

  async getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const configured = Boolean(ctx.config.baseUrl && ctx.credentials.apiKey);
    let integrations = false;
    if (configured) {
      try {
        await http(ctx, `${this.base(ctx)}${ctx.config.integrationsPath ?? '/public/v1/integrations'}`, {
          headers: this.headers(ctx),
          maxAttempts: 1,
        });
        integrations = true;
      } catch {
        integrations = false;
      }
    }
    return {
      provider: 'postiz',
      state: !configured ? 'NOT_CONFIGURED' : integrations ? 'ACTIVE' : 'UNSUPPORTED',
      read: integrations,
      write: false,
      incrementalSync: false,
      flags: { listIntegrations: integrations, listPosts: integrations, schedule: false },
      blockers: configured
        ? integrations
          ? ['Write/scheduling through Postiz is intentionally not enabled (read-only sync).']
          : ['Postiz did not answer the integrations endpoint; this version may not expose the public API.']
        : ['Postiz is optional and not configured.'],
      setupSteps: [
        'Install Postiz (self-hosted or hosted).',
        'Generate a public API key in Postiz settings.',
        'Set POSTIZ_BASE_URL and POSTIZ_API_KEY, then Test connection.',
      ],
    };
  }
  async connect(ctx: ConnectorContext): Promise<ConnectResult> {
    const caps = await this.getCapabilities(ctx);
    return caps.state === 'ACTIVE'
      ? { status: 'CONNECTED' }
      : { status: 'NOT_CONFIGURED', steps: caps.setupSteps };
  }
  async disconnect() {}
  async refreshCredentials(ctx: ConnectorContext): Promise<Credentials> {
    return ctx.credentials;
  }
  async health(ctx: ConnectorContext): Promise<HealthResult> {
    const caps = await this.getCapabilities(ctx);
    return { ok: caps.state === 'ACTIVE', state: caps.state, detail: caps.blockers[0], checkedAt: iso(ctx) };
  }
  async rateLimitBudget(): Promise<RateLimitBudget> {
    return { remaining: null, limit: null, resetsAt: null, estimated: true };
  }
  normalize(p: PostizPost): NormalizedPost {
    const st = (p.state ?? '').toUpperCase();
    const published = st === 'PUBLISHED' || Boolean(p.releaseURL);
    return {
      provider: 'postiz',
      externalId: p.releaseId ?? p.id,
      url: p.releaseURL ?? null,
      title: null,
      description: p.content ?? null,
      publishedAt: published ? (p.publishDate ?? null) : null,
      durationMs: null,
      privacy: 'PUBLIC',
      // Only a returned release URL counts as evidence; otherwise we do not claim it is live.
      state:
        published && p.releaseURL
          ? 'PUBLISHED_VERIFIED'
          : st === 'ERROR'
            ? 'FAILED'
            : st === 'QUEUE' || st === 'SCHEDULED'
              ? 'SCHEDULED'
              : 'UNKNOWN',
      stats: null,
      thumbnailUrl: null,
      accountExternalId: p.integration?.id ?? null,
    };
  }
  async getExternalRecord(): Promise<NormalizedPost | null> {
    return null;
  }
  async syncFull(ctx: ConnectorContext): Promise<SyncResult<NormalizedPost>> {
    const start = new Date(ctx.now() - 90 * 86400_000).toISOString();
    const end = new Date(ctx.now() + 90 * 86400_000).toISOString();
    const { data } = await http<any>(ctx, `${this.base(ctx)}${ctx.config.postsPath ?? '/public/v1/posts'}`, {
      headers: this.headers(ctx),
      query: { startDate: start, endDate: end },
    });
    const list: PostizPost[] = Array.isArray(data) ? data : (data?.posts ?? []);
    return { items: list.map((p) => this.normalize(p)), nextCursor: iso(ctx), hasMore: false };
  }
  syncIncremental(ctx: ConnectorContext): Promise<SyncResult<NormalizedPost>> {
    return this.syncFull(ctx);
  }
}

/* ---------------------------------------------------------------- Instagram (professional accounts via Graph API) */

interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  thumbnail_url?: string;
  media_url?: string;
}

/**
 * Instagram professional account media import using a token the owner generated in their Meta developer app.
 * Publishing and DM reading are NOT implemented: they need App Review (instagram_content_publish,
 * instagram_manage_messages) and we never scrape private pages.
 */
export class InstagramConnector implements Connector<NormalizedPost, IgMedia> {
  readonly id = 'meta' as const;

  async getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const configured = Boolean(ctx.credentials.accessToken && ctx.config.igUserId);
    return {
      provider: 'meta',
      state: configured ? 'ACTIVE' : 'NOT_CONFIGURED',
      read: configured,
      write: false,
      incrementalSync: configured,
      flags: { importMedia: configured, ownInsights: false, publish: false, readDirectMessages: false },
      blockers: [
        'Reading Instagram DMs requires Meta App Review for instagram_manage_messages and a connected Facebook Page; not available by default.',
        'Publishing via API requires instagram_content_publish approval; use manual publish records until approved.',
        ...(configured
          ? []
          : ['Provide an Instagram professional-account access token and IG user id (Integrations → Meta).']),
      ],
      setupSteps: [
        'Convert the Instagram account to Professional (Creator/Business) and link it to a Facebook Page.',
        'Create a Meta developer app, add Instagram Graph API, generate a long-lived access token with instagram_basic.',
        'Enter the token and the Instagram user id in Integrations → Meta, then Test connection.',
      ],
    };
  }
  async connect(ctx: ConnectorContext): Promise<ConnectResult> {
    const caps = await this.getCapabilities(ctx);
    return caps.state === 'ACTIVE'
      ? { status: 'CONNECTED' }
      : { status: 'REQUIRES_APPROVAL', steps: caps.setupSteps };
  }
  async disconnect() {}
  async refreshCredentials(ctx: ConnectorContext): Promise<Credentials> {
    return ctx.credentials;
  }
  private url(ctx: ConnectorContext, path: string) {
    return `https://graph.facebook.com/${ctx.config.graphVersion ?? 'v21.0'}${path}`;
  }
  async health(ctx: ConnectorContext): Promise<HealthResult> {
    try {
      if (!ctx.credentials.accessToken || !ctx.config.igUserId)
        throw new ConnectorError('NOT_CONFIGURED', 'Instagram token / user id missing');
      await http(ctx, this.url(ctx, `/${ctx.config.igUserId}`), {
        query: { fields: 'id,username', access_token: ctx.credentials.accessToken },
        maxAttempts: 1,
      });
      return { ok: true, state: 'ACTIVE', checkedAt: iso(ctx) };
    } catch (e) {
      const err = e as ConnectorError;
      return {
        ok: false,
        state:
          err.kind === 'NOT_CONFIGURED'
            ? 'NOT_CONFIGURED'
            : err.kind === 'AUTH_EXPIRED'
              ? 'AUTH_EXPIRED'
              : 'ERROR',
        detail: err.message,
        checkedAt: iso(ctx),
      };
    }
  }
  async rateLimitBudget(): Promise<RateLimitBudget> {
    return { remaining: null, limit: null, resetsAt: null, estimated: true };
  }
  normalize(m: IgMedia): NormalizedPost {
    return {
      provider: 'meta',
      externalId: m.id,
      url: m.permalink ?? null,
      title: null,
      description: m.caption ?? null,
      publishedAt: m.timestamp ?? null,
      durationMs: null,
      privacy: 'PUBLIC',
      state: 'PUBLISHED_VERIFIED',
      stats: { likes: m.like_count, comments: m.comments_count },
      thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
      accountExternalId: null,
    };
  }
  async getExternalRecord(ctx: ConnectorContext, id: string): Promise<NormalizedPost | null> {
    try {
      const { data } = await http<IgMedia>(ctx, this.url(ctx, `/${id}`), {
        query: {
          fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count,thumbnail_url',
          access_token: ctx.credentials.accessToken,
        },
      });
      return this.normalize(data);
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'NOT_FOUND') return null;
      throw e;
    }
  }
  async syncFull(ctx: ConnectorContext, stopBefore?: string | null): Promise<SyncResult<NormalizedPost>> {
    if (!ctx.credentials.accessToken || !ctx.config.igUserId)
      throw new ConnectorError('NOT_CONFIGURED', 'Instagram token / user id missing');
    const items: NormalizedPost[] = [];
    let next: string | undefined = this.url(ctx, `/${ctx.config.igUserId}/media`);
    let query: Record<string, string> | undefined = {
      fields:
        'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url',
      limit: '50',
      access_token: ctx.credentials.accessToken,
    };
    let newest: string | null = null;
    let pages = 0;
    while (next && pages < 40) {
      type Page = { data?: IgMedia[]; paging?: { next?: string } };
      const res: { data: Page } = await http<Page>(ctx, next, { query });
      const data: Page = res.data;
      let stop = false;
      for (const m of data.data ?? []) {
        if (stopBefore && m.timestamp && m.timestamp <= stopBefore) {
          stop = true;
          continue;
        }
        if (m.timestamp && (!newest || m.timestamp > newest)) newest = m.timestamp;
        items.push(this.normalize(m));
      }
      next = stop ? undefined : data.paging?.next;
      query = undefined; // `next` already carries the query string
      pages += 1;
    }
    return { items, nextCursor: newest ?? stopBefore ?? null, hasMore: false };
  }
  syncIncremental(ctx: ConnectorContext, cursor: string | null): Promise<SyncResult<NormalizedPost>> {
    return this.syncFull(ctx, cursor);
  }
}

/* ---------------------------------------------------------------- TikTok (Display API video.list) */

interface TikTokVideo {
  id: string;
  title?: string;
  video_description?: string;
  duration?: number;
  create_time?: number;
  share_url?: string;
  cover_image_url?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

export class TikTokConnector implements Connector<NormalizedPost, TikTokVideo> {
  readonly id = 'tiktok' as const;

  async getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const hasClient = Boolean(ctx.config.clientKey && ctx.config.clientSecret && ctx.config.redirectUri);
    const connected = Boolean(ctx.credentials.accessToken || ctx.credentials.refreshToken);
    const list = connected && (ctx.credentials.scopes ?? []).includes('video.list');
    return {
      provider: 'tiktok',
      state: !hasClient ? 'NOT_CONFIGURED' : !connected ? 'NOT_CONFIGURED' : 'ACTIVE',
      read: list,
      write: false,
      incrementalSync: list,
      flags: { listVideos: list, directPost: false, readDirectMessages: false },
      blockers: [
        'Direct posting needs the Content Posting API audit; until approved only private posts are possible. Creator OS shows this as manual / requires approval.',
        'TikTok DMs cannot be read through any public API.',
        ...(hasClient ? [] : ['TikTok developer app not configured (client key/secret/redirect).']),
      ],
      setupSteps: [
        'Register an app at developers.tiktok.com and add the Login Kit + Display API products.',
        'Request the user.info.basic and video.list scopes and add the redirect URI shown in Integrations.',
        'Enter client key/secret in Integrations → TikTok and press Connect.',
      ],
    };
  }
  async connect(ctx: ConnectorContext): Promise<ConnectResult> {
    if (!ctx.config.clientKey || !ctx.config.redirectUri)
      return { status: 'NOT_CONFIGURED', steps: (await this.getCapabilities(ctx)).setupSteps };
    const pkce = generatePkce();
    const state = randomState();
    const scopes = ['user.info.basic', 'video.list'];
    const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
    u.searchParams.set('client_key', ctx.config.clientKey);
    u.searchParams.set('scope', scopes.join(','));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', ctx.config.redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', pkce.challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return {
      status: 'REDIRECT',
      authorizeUrl: u.toString(),
      oauth: { state, verifier: pkce.verifier, scopes },
    };
  }
  async exchangeCode(ctx: ConnectorContext, code: string, verifier: string): Promise<Credentials> {
    const { data } = await http<any>(ctx, 'https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      form: {
        client_key: ctx.config.clientKey,
        client_secret: ctx.config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: ctx.config.redirectUri,
        code_verifier: verifier,
      },
      maxAttempts: 1,
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: ctx.now() + (data.expires_in ?? 86400) * 1000,
      scopes: String(data.scope ?? '')
        .split(',')
        .filter(Boolean),
      principal: data.open_id,
    };
  }
  async disconnect() {}
  async refreshCredentials(ctx: ConnectorContext): Promise<Credentials> {
    if (!ctx.credentials.refreshToken)
      throw new ConnectorError('AUTH_EXPIRED', 'No TikTok refresh token; reconnect.');
    const { data } = await http<any>(ctx, 'https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      form: {
        client_key: ctx.config.clientKey,
        client_secret: ctx.config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: ctx.credentials.refreshToken,
      },
      maxAttempts: 2,
      idempotent: true,
    });
    return {
      ...ctx.credentials,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? ctx.credentials.refreshToken,
      expiresAt: ctx.now() + (data.expires_in ?? 86400) * 1000,
    };
  }
  private async token(ctx: ConnectorContext): Promise<string> {
    const c = ctx.credentials;
    if (!c.accessToken && !c.refreshToken)
      throw new ConnectorError('NOT_CONFIGURED', 'TikTok account not connected.');
    if (c.accessToken && (!c.expiresAt || c.expiresAt - 120_000 > ctx.now())) return c.accessToken;
    const next = await this.refreshCredentials(ctx);
    ctx.credentials = next;
    await ctx.onCredentials?.(next);
    return next.accessToken!;
  }
  async health(ctx: ConnectorContext): Promise<HealthResult> {
    try {
      const t = await this.token(ctx);
      await http(ctx, 'https://open.tiktokapis.com/v2/user/info/', {
        headers: { authorization: `Bearer ${t}` },
        query: { fields: 'open_id' },
        maxAttempts: 1,
      });
      return { ok: true, state: 'ACTIVE', checkedAt: iso(ctx) };
    } catch (e) {
      const err = e as ConnectorError;
      return {
        ok: false,
        state:
          err.kind === 'NOT_CONFIGURED'
            ? 'NOT_CONFIGURED'
            : err.kind === 'AUTH_EXPIRED'
              ? 'AUTH_EXPIRED'
              : 'ERROR',
        detail: err.message,
        checkedAt: iso(ctx),
      };
    }
  }
  async rateLimitBudget(): Promise<RateLimitBudget> {
    return { remaining: null, limit: null, resetsAt: null, estimated: true };
  }
  normalize(v: TikTokVideo): NormalizedPost {
    return {
      provider: 'tiktok',
      externalId: v.id,
      url: v.share_url ?? null,
      title: v.title ?? null,
      description: v.video_description ?? null,
      publishedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
      durationMs: v.duration ? v.duration * 1000 : null,
      privacy: 'PUBLIC',
      state: 'PUBLISHED_VERIFIED',
      stats: { views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count },
      thumbnailUrl: v.cover_image_url ?? null,
      accountExternalId: null,
    };
  }
  async getExternalRecord(): Promise<NormalizedPost | null> {
    return null;
  }
  async syncFull(ctx: ConnectorContext, stopBefore?: number | null): Promise<SyncResult<NormalizedPost>> {
    const t = await this.token(ctx);
    const items: NormalizedPost[] = [];
    let cursor: number | undefined;
    let pages = 0;
    let newest: number | null = null;
    let more = true;
    while (more && pages < 40) {
      const { data } = await http<any>(ctx, 'https://open.tiktokapis.com/v2/video/list/', {
        method: 'POST',
        headers: { authorization: `Bearer ${t}` },
        query: {
          fields:
            'id,title,video_description,duration,create_time,share_url,cover_image_url,view_count,like_count,comment_count,share_count',
        },
        json: { max_count: 20, ...(cursor !== undefined ? { cursor } : {}) },
        idempotent: true,
      });
      let stop = false;
      for (const v of (data?.data?.videos ?? []) as TikTokVideo[]) {
        if (stopBefore && v.create_time && v.create_time <= stopBefore) {
          stop = true;
          continue;
        }
        if (v.create_time && (!newest || v.create_time > newest)) newest = v.create_time;
        items.push(this.normalize(v));
      }
      more = !stop && Boolean(data?.data?.has_more);
      cursor = data?.data?.cursor;
      pages += 1;
    }
    return { items, nextCursor: String(newest ?? stopBefore ?? ''), hasMore: false };
  }
  syncIncremental(ctx: ConnectorContext, cursor: string | null): Promise<SyncResult<NormalizedPost>> {
    return this.syncFull(ctx, cursor ? Number(cursor) : null);
  }
}

/* ---------------------------------------------------------------- Capability-gated placeholders (Snapchat etc.) */

export class GatedConnector implements Connector<NormalizedPost, never> {
  constructor(
    readonly id: Provider,
    private readonly blockers: string[],
    private readonly steps: string[],
  ) {}
  async getCapabilities(): Promise<ConnectorCapabilities> {
    return {
      provider: this.id,
      state: 'UNSUPPORTED',
      read: false,
      write: false,
      incrementalSync: false,
      flags: {},
      blockers: this.blockers,
      setupSteps: this.steps,
    };
  }
  async connect(): Promise<ConnectResult> {
    return { status: 'REQUIRES_APPROVAL', steps: this.steps };
  }
  async disconnect() {}
  async refreshCredentials(ctx: ConnectorContext): Promise<Credentials> {
    return ctx.credentials;
  }
  async syncIncremental(): Promise<SyncResult<NormalizedPost>> {
    throw new ConnectorError('UNSUPPORTED', this.blockers[0] ?? 'Not supported');
  }
  async syncFull(): Promise<SyncResult<NormalizedPost>> {
    throw new ConnectorError('UNSUPPORTED', this.blockers[0] ?? 'Not supported');
  }
  async health(ctx: ConnectorContext): Promise<HealthResult> {
    return { ok: false, state: 'UNSUPPORTED', detail: this.blockers[0], checkedAt: iso(ctx) };
  }
  async rateLimitBudget(): Promise<RateLimitBudget> {
    return { remaining: null, limit: null, resetsAt: null, estimated: true };
  }
  normalize(): NormalizedPost {
    throw new ConnectorError('UNSUPPORTED', 'Not supported');
  }
  async getExternalRecord(): Promise<NormalizedPost | null> {
    return null;
  }
}
