import { createHmac, timingSafeEqual } from 'node:crypto';
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
import { http } from '../http';
import { randomState } from '../pkce';
import { oauthScopes } from '@creatoros/domain';

/**
 * Threads API. It lives on the same Meta app as Facebook, but it is a separate login.
 * Facebook Page permissions do not grant Threads access.
 * Connect requests every Threads permission the Meta app has ready for testing.
 * A post, reply, or delete still happens only after the owner confirms that one action.
 */
export const THREADS_SCOPES = {
  basic: 'threads_basic',
  publish: 'threads_content_publish',
  delete: 'threads_delete',
  insights: 'threads_manage_insights',
  mentions: 'threads_manage_mentions',
  manageReplies: 'threads_manage_replies',
  discovery: 'threads_profile_discovery',
  readReplies: 'threads_read_replies',
  shareToInstagram: 'threads_share_to_instagram',
} as const;
export const THREADS_ALL_SCOPES: string[] = Object.values(THREADS_SCOPES);

export const THREADS_AUTH_URL = 'https://threads.net/oauth/authorize';
export const THREADS_TOKEN_URL = 'https://graph.threads.net/oauth/access_token';
export const THREADS_GRAPH = 'https://graph.threads.net';
export const THREADS_VERSION = 'v1.0';

export interface ThreadsClientConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/** Threads App ID is often the Meta app id. A dedicated Threads secret, when Meta shows one, wins over the Facebook secret. */
export function readThreadsClientConfig(
  env: Record<string, string | undefined>,
  appBaseUrl: string,
): ThreadsClientConfig | null {
  const appId = env.THREADS_APP_ID || env.FACEBOOK_APP_ID;
  const appSecret = env.THREADS_APP_SECRET || env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return null;
  const base = appBaseUrl.replace(/\/$/, '');
  return {
    appId,
    appSecret,
    redirectUri: env.THREADS_REDIRECT_URI || `${base}/api/v1/integrations/threads/callback`,
  };
}

export function buildThreadsAuthUrl(args: { client: ThreadsClientConfig; scopes: string[]; state: string }): string {
  const u = new URL(THREADS_AUTH_URL);
  u.searchParams.set('client_id', args.client.appId);
  u.searchParams.set('redirect_uri', args.client.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', args.scopes.join(','));
  u.searchParams.set('state', args.state);
  return u.toString();
}

function b64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/** Meta uninstall and data-deletion bodies. The signature is HMAC-SHA256 of the payload segment, using the app secret. */
export function parseThreadsSignedRequest(signedRequest: string, secret: string): { userId: string } | null {
  const dot = signedRequest.indexOf('.');
  if (dot <= 0 || !secret) return null;
  const encodedSig = signedRequest.slice(0, dot);
  const payload = signedRequest.slice(dot + 1);
  const sig = b64url(encodedSig);
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(b64url(payload).toString('utf8')) as { algorithm?: string; user_id?: string | number };
    if (data.algorithm !== 'HMAC-SHA256' || data.user_id == null || String(data.user_id) === '') return null;
    return { userId: String(data.user_id) };
  } catch {
    return null;
  }
}

export function threadsCallbackUrls(redirectUri: string): { deauthorize: string; dataDeletion: string } | null {
  try {
    const origin = new URL(redirectUri).origin;
    return {
      deauthorize: `${origin}/api/v1/integrations/threads/deauthorize`,
      dataDeletion: `${origin}/api/v1/integrations/threads/data-deletion`,
    };
  } catch {
    return null;
  }
}

export function threadsCapabilityMatrix(granted: string[]) {
  const has = (s: string) => granted.includes(s);
  const flags = {
    profile: has(THREADS_SCOPES.basic),
    importMedia: has(THREADS_SCOPES.basic),
    insights: has(THREADS_SCOPES.insights),
    publish: has(THREADS_SCOPES.publish),
    delete: has(THREADS_SCOPES.delete),
    mentions: has(THREADS_SCOPES.mentions),
    manageReplies: has(THREADS_SCOPES.manageReplies),
    discovery: has(THREADS_SCOPES.discovery),
    readReplies: has(THREADS_SCOPES.readReplies),
    shareToInstagram: has(THREADS_SCOPES.shareToInstagram),
  };
  const missing = THREADS_ALL_SCOPES.filter((s) => !granted.includes(s));
  return { flags, missing };
}

export interface ThreadsProfile {
  userId: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  biography: string | null;
}

const asScopes = (p: unknown): string[] =>
  Array.isArray(p)
    ? p.map(String)
    : typeof p === 'string'
      ? p.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      : [];

function stripSecret(message: string) {
  return message.replace(/client_secret=[^&\s]+/gi, 'client_secret=redacted').replace(/access_token=[^&\s]+/gi, 'access_token=redacted');
}

const bearer = (token: string | undefined) => {
  if (!token) throw new ConnectorError('AUTH_EXPIRED', 'Threads is not connected');
  return { authorization: `Bearer ${token}` };
};

/** Short-lived code, then a 60-day token. Threads Login has no PKCE. */
export async function exchangeThreadsCode(
  ctx: ConnectorContext,
  client: ThreadsClientConfig,
  rawCode: string,
): Promise<Credentials> {
  const code = rawCode.replace(/#_$/, '');
  let data: any;
  try {
    const res = await http<any>(ctx, THREADS_TOKEN_URL, {
      method: 'POST',
      form: {
        client_id: client.appId,
        client_secret: client.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: client.redirectUri,
        code,
      },
      maxAttempts: 1,
    });
    data = res.data;
  } catch (e) {
    if (e instanceof ConnectorError) throw new ConnectorError(e.kind, stripSecret(e.message), { status: e.status });
    throw e;
  }
  if (!data?.access_token)
    throw new ConnectorError('BAD_REQUEST', 'Threads did not return an access token for this code.');
  const short: Credentials = {
    accessToken: String(data.access_token),
    principal: data.user_id != null ? String(data.user_id) : undefined,
    scopes: asScopes(data.permissions ?? data.scope),
  };
  const long = await exchangeThreadsLongLived(ctx, client, short.accessToken!);
  return { ...short, ...long, scopes: short.scopes?.length ? short.scopes : (long.scopes ?? []), principal: short.principal };
}

export async function exchangeThreadsLongLived(
  ctx: ConnectorContext,
  client: ThreadsClientConfig,
  shortToken: string,
): Promise<Credentials> {
  try {
    const { data } = await http<any>(ctx, `${THREADS_GRAPH}/access_token`, {
      query: { grant_type: 'th_exchange_token', client_secret: client.appSecret, access_token: shortToken },
      maxAttempts: 2,
    });
    if (!data?.access_token) throw new ConnectorError('BAD_REQUEST', 'Threads did not return a long-lived token.');
    return {
      accessToken: String(data.access_token),
      expiresAt: ctx.now() + Number(data.expires_in ?? 5_184_000) * 1000,
      tokenType: data.token_type ?? 'bearer',
      scopes: asScopes(data.scope),
    };
  } catch (e) {
    if (e instanceof ConnectorError) throw new ConnectorError(e.kind, stripSecret(e.message), { status: e.status });
    throw e;
  }
}

export async function refreshThreadsToken(ctx: ConnectorContext): Promise<Credentials> {
  const token = ctx.credentials.accessToken;
  if (!token) throw new ConnectorError('AUTH_EXPIRED', 'No Threads token stored. Reconnect the account.');
  try {
    const { data } = await http<any>(ctx, `${THREADS_GRAPH}/refresh_access_token`, {
      query: { grant_type: 'th_refresh_token', access_token: token },
      maxAttempts: 2,
    });
    if (!data?.access_token) throw new ConnectorError('AUTH_EXPIRED', 'Threads did not refresh the token. Reconnect the account.');
    return {
      ...ctx.credentials,
      accessToken: String(data.access_token),
      expiresAt: ctx.now() + Number(data.expires_in ?? 5_184_000) * 1000,
    };
  } catch (e) {
    if (e instanceof ConnectorError && (e.kind === 'BAD_REQUEST' || e.kind === 'AUTH_EXPIRED'))
      throw new ConnectorError('AUTH_EXPIRED', 'The Threads login expired. Reconnect the account.', { status: e.status });
    throw e;
  }
}

export async function fetchThreadsProfile(ctx: ConnectorContext, version = THREADS_VERSION): Promise<ThreadsProfile> {
  const { data } = await http<any>(ctx, `${THREADS_GRAPH}/${version}/me`, {
    headers: bearer(ctx.credentials.accessToken),
    query: { fields: 'id,username,name,threads_profile_picture_url,threads_biography' },
    maxAttempts: 2,
  });
  const id = data?.id;
  if (!id) throw new ConnectorError('BAD_REQUEST', 'Threads did not return an account id.');
  return {
    userId: String(id),
    username: data.username ?? null,
    name: data.name ?? null,
    profilePictureUrl: data.threads_profile_picture_url ?? null,
    biography: data.threads_biography ?? null,
  };
}

export function parseThreadsInsightValues(data: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const row of (data as { data?: any[] })?.data ?? []) {
    const raw = row?.total_value?.value ?? row?.values?.[0]?.value;
    out[String(row.name)] = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }
  return out;
}

const MEDIA_INSIGHTS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];

async function insightCall(ctx: ConnectorContext, path: string, metric: string, version: string) {
  const { data } = await http<unknown>(ctx, `${THREADS_GRAPH}/${version}/${path}`, {
    headers: bearer(ctx.credentials.accessToken),
    query: { metric },
    maxAttempts: 2,
  });
  return parseThreadsInsightValues(data);
}

/** One post. A metric Threads rejects is skipped so the others are kept. */
export async function fetchThreadsMediaInsights(
  ctx: ConnectorContext,
  mediaId: string,
  version = THREADS_VERSION,
): Promise<Record<string, number | null>> {
  const path = `${encodeURIComponent(mediaId)}/insights`;
  try {
    return await insightCall(ctx, path, MEDIA_INSIGHTS.join(','), version);
  } catch (e) {
    if (!(e instanceof ConnectorError)) throw e;
    const out: Record<string, number | null> = {};
    for (const metric of MEDIA_INSIGHTS) {
      try {
        Object.assign(out, await insightCall(ctx, path, metric, version));
      } catch (err) {
        if (!(err instanceof ConnectorError)) throw err;
      }
    }
    return out;
  }
}

/** Current follower total. Null when Threads omits the metric. */
export async function fetchThreadsFollowers(ctx: ConnectorContext, version = THREADS_VERSION): Promise<number | null> {
  const values = await insightCall(ctx, 'me/threads_insights', 'followers_count', version);
  return values.followers_count ?? null;
}

interface ThreadsMedia {
  id: string;
  text?: string;
  permalink?: string;
  timestamp?: string;
  thumbnail_url?: string;
  media_url?: string;
  media_type?: string;
  media_product_type?: string;
  shortcode?: string;
}

function isThreadsUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && p.hostname === 'graph.threads.net' && !p.username && !p.port;
  } catch {
    return false;
  }
}

export class ThreadsConnector implements Connector<NormalizedPost, ThreadsMedia> {
  readonly id = 'threads' as const;

  private client(ctx: ConnectorContext): ThreadsClientConfig | null {
    return (ctx.config.threadsClient as ThreadsClientConfig | undefined) ?? null;
  }

  async getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const client = this.client(ctx);
    const connected = Boolean(ctx.credentials.accessToken);
    const granted = ctx.credentials.scopes ?? [];
    const { flags, missing } = threadsCapabilityMatrix(connected ? granted : []);
    const blockers: string[] = [];
    if (!client) blockers.push('Threads is not configured. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET, or THREADS_APP_ID and THREADS_APP_SECRET.');
    if (connected && missing.length) blockers.push(`Not granted: ${missing.join(', ')}. Reconnect and approve them.`);
    blockers.push('A post, reply, or delete is sent only after you confirm that one action.');
    const callbacks = client ? threadsCallbackUrls(client.redirectUri) : null;
    return {
      provider: 'threads',
      state: connected ? 'ACTIVE' : 'NOT_CONFIGURED',
      read: connected && flags.importMedia,
      write: false,
      incrementalSync: connected && flags.importMedia,
      flags: {
        ...flags,
        appConfigured: Boolean(client),
        redirectUri: client?.redirectUri ?? null,
        deauthorizeUrl: callbacks?.deauthorize ?? null,
        dataDeletionUrl: callbacks?.dataDeletion ?? null,
        connected,
      },
      blockers,
      setupSteps: [
        'On the Meta app, add the Threads use case. Facebook Page permissions do not include Threads.',
        callbacks
          ? `In Threads API settings, set the login redirect shown on this card, the uninstall URL ${callbacks.deauthorize}, and the deletion URL ${callbacks.dataDeletion}.`
          : 'In Threads API settings, add the login redirect shown on this card, plus the uninstall and deletion URLs.',
        'Press Connect Threads and check only the permissions this Meta app already has. Add the others later from the same list.',
        'If Meta shows a Threads App ID that is not the Facebook App ID, put it in THREADS_APP_ID and THREADS_APP_SECRET.',
      ],
    };
  }

  async connect(ctx: ConnectorContext, input: Record<string, unknown> = {}): Promise<ConnectResult> {
    const client = this.client(ctx);
    if (!client) return { status: 'NOT_CONFIGURED', steps: (await this.getCapabilities(ctx)).setupSteps };
    const scopes = Array.isArray(input.scopes) ? oauthScopes('threads', input.scopes) : [...THREADS_ALL_SCOPES];
    const state = randomState();
    return {
      status: 'REDIRECT',
      authorizeUrl: buildThreadsAuthUrl({ client, scopes, state }),
      oauth: { state, verifier: '', scopes },
    };
  }

  async disconnect(_ctx: ConnectorContext) {}

  refreshCredentials(ctx: ConnectorContext): Promise<Credentials> {
    return refreshThreadsToken(ctx);
  }

  async health(ctx: ConnectorContext): Promise<HealthResult> {
    const checkedAt = new Date(ctx.now()).toISOString();
    try {
      if (!ctx.credentials.accessToken) throw new ConnectorError('NOT_CONFIGURED', 'Threads is not connected');
      await fetchThreadsProfile(ctx);
      return { ok: true, state: 'ACTIVE', checkedAt };
    } catch (e) {
      const err = e as ConnectorError;
      return {
        ok: false,
        state: err.kind === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : err.kind === 'AUTH_EXPIRED' || err.kind === 'AUTH_REVOKED' ? 'AUTH_EXPIRED' : 'ERROR',
        detail: stripSecret(err.message ?? 'Threads check failed'),
        checkedAt,
      };
    }
  }

  async rateLimitBudget(_ctx: ConnectorContext): Promise<RateLimitBudget> {
    return { remaining: null, limit: null, resetsAt: null, estimated: true };
  }

  normalize(m: ThreadsMedia): NormalizedPost {
    const text = typeof m.text === 'string' ? m.text : '';
    const url = m.permalink ?? (m.shortcode ? `https://www.threads.net/t/${m.shortcode}` : null);
    return {
      provider: 'threads',
      externalId: m.id,
      url,
      title: text ? text.split('\n')[0]!.slice(0, 140) : null,
      description: text || null,
      publishedAt: m.timestamp ?? null,
      durationMs: null,
      privacy: 'PUBLIC',
      state: 'PUBLISHED_VERIFIED',
      stats: null,
      thumbnailUrl: m.thumbnail_url ?? (m.media_type === 'IMAGE' ? (m.media_url ?? null) : null),
      accountExternalId: null,
      raw: { mediaType: m.media_type ?? null, productType: m.media_product_type ?? null },
    };
  }

  async getExternalRecord(ctx: ConnectorContext, id: string): Promise<NormalizedPost | null> {
    try {
      const { data } = await http<ThreadsMedia>(ctx, `${THREADS_GRAPH}/${THREADS_VERSION}/${encodeURIComponent(id)}`, {
        headers: bearer(ctx.credentials.accessToken),
        query: { fields: 'id,text,permalink,timestamp,media_type,media_product_type,thumbnail_url,shortcode' },
      });
      return this.normalize(data);
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'NOT_FOUND') return null;
      throw e;
    }
  }

  async syncFull(ctx: ConnectorContext): Promise<SyncResult<NormalizedPost>> {
    if (!ctx.credentials.accessToken) throw new ConnectorError('NOT_CONFIGURED', 'Threads is not connected');
    await this.renewIfDue(ctx);
    const items: NormalizedPost[] = [];
    let next: string | undefined = `${THREADS_GRAPH}/${THREADS_VERSION}/me/threads`;
    let query: Record<string, string> | undefined = {
      fields: 'id,text,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,shortcode',
      limit: '25',
    };
    let newest: string | null = null;
    for (let pages = 0; next && pages < 20; pages++) {
      const res: { data: { data?: ThreadsMedia[]; paging?: { next?: string } } } = await http(ctx, next, {
        headers: bearer(ctx.credentials.accessToken),
        query,
      });
      for (const m of res.data.data ?? []) {
        if (m.timestamp && (!newest || m.timestamp > newest)) newest = m.timestamp;
        items.push(this.normalize(m));
      }
      const candidate = res.data.paging?.next;
      next = candidate && isThreadsUrl(candidate) ? candidate : undefined;
      query = undefined;
    }
    return { items, nextCursor: newest, hasMore: false };
  }

  syncIncremental(ctx: ConnectorContext, _cursor: string | null) {
    return this.syncFull(ctx);
  }

  private async renewIfDue(ctx: ConnectorContext) {
    const exp = ctx.credentials.expiresAt;
    if (!exp || exp - ctx.now() > 7 * 24 * 3600_000) return;
    const next = await refreshThreadsToken(ctx);
    await ctx.onCredentials?.(next);
    ctx.credentials.accessToken = next.accessToken;
    ctx.credentials.expiresAt = next.expiresAt;
  }
}
