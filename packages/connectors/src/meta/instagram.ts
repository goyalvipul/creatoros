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

/**
 * Instagram API with Instagram Login (professional accounts, no Facebook Page needed).
 * These scopes belong ONLY to this flow; never mix them with Facebook Login permissions.
 * Endpoints and the Graph version are configurable because they could not be re-verified against the live Meta
 * documentation when this was written (docs were not reachable); see docs/EXTERNAL_PREREQUISITES.md.
 */
export const INSTAGRAM_SCOPES = {
  basic: 'instagram_business_basic',
  publish: 'instagram_business_content_publish',
  comments: 'instagram_business_manage_comments',
  messages: 'instagram_business_manage_messages',
} as const;
export const INSTAGRAM_ALL_SCOPES: string[] = Object.values(INSTAGRAM_SCOPES);

export const INSTAGRAM_AUTH_URL = 'https://www.instagram.com/oauth/authorize';
export const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
export const INSTAGRAM_GRAPH = 'https://graph.instagram.com';
export const DEFAULT_GRAPH_VERSION = 'v23.0';

export interface InstagramClientConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  webhookVerifyToken?: string;
  graphVersion: string;
}

export function readInstagramClientConfig(
  env: Record<string, string | undefined>,
): InstagramClientConfig | null {
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET || !env.INSTAGRAM_REDIRECT_URI) return null;
  return {
    appId: env.INSTAGRAM_APP_ID,
    appSecret: env.INSTAGRAM_APP_SECRET,
    redirectUri: env.INSTAGRAM_REDIRECT_URI,
    webhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN || undefined,
    graphVersion: env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
  };
}

export function buildInstagramAuthUrl(args: {
  client: InstagramClientConfig;
  scopes: string[];
  state: string;
  forceReauth?: boolean;
}): string {
  const u = new URL(INSTAGRAM_AUTH_URL);
  u.searchParams.set('client_id', args.client.appId);
  u.searchParams.set('redirect_uri', args.client.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', args.scopes.join(','));
  u.searchParams.set('state', args.state);
  u.searchParams.set('enable_fb_login', '0');
  if (args.forceReauth) u.searchParams.set('force_reauth', 'true');
  return u.toString();
}

export interface InstagramProfile {
  userId: string;
  username: string | null;
  name: string | null;
  accountType: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  mediaCount: number | null;
}

const asScopes = (p: unknown): string[] =>
  Array.isArray(p)
    ? p.map(String)
    : typeof p === 'string'
      ? p
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

/** Short-lived code -> short-lived token -> 60 day token. Instagram Login has no PKCE; `state` is the CSRF defence. */
export async function exchangeInstagramCode(
  ctx: ConnectorContext,
  client: InstagramClientConfig,
  rawCode: string,
): Promise<Credentials> {
  const code = rawCode.replace(/#_$/, ''); // Instagram appends "#_" to the code
  const { data } = await http<any>(ctx, INSTAGRAM_TOKEN_URL, {
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
  const row = Array.isArray(data?.data) ? data.data[0] : data;
  if (!row?.access_token)
    throw new ConnectorError('BAD_REQUEST', 'Instagram did not return an access token for this code.');
  const short: Credentials = {
    accessToken: String(row.access_token),
    principal: row.user_id != null ? String(row.user_id) : undefined,
    scopes: asScopes(row.permissions),
  };
  const long = await exchangeInstagramLongLived(ctx, client, short.accessToken!);
  return { ...short, ...long, scopes: short.scopes, principal: short.principal };
}

export async function exchangeInstagramLongLived(
  ctx: ConnectorContext,
  client: InstagramClientConfig,
  shortToken: string,
): Promise<Credentials> {
  const { data } = await http<any>(ctx, `${INSTAGRAM_GRAPH}/access_token`, {
    query: { grant_type: 'ig_exchange_token', client_secret: client.appSecret, access_token: shortToken },
    maxAttempts: 2,
  });
  if (!data?.access_token)
    throw new ConnectorError('BAD_REQUEST', 'Instagram did not return a long-lived token.');
  return {
    accessToken: String(data.access_token),
    expiresAt: ctx.now() + Number(data.expires_in ?? 5_184_000) * 1000,
    tokenType: data.token_type ?? 'bearer',
  };
}

/** Long-lived tokens can be refreshed after 24h and before they expire. Expired tokens need reauthorization. */
export async function refreshInstagramToken(ctx: ConnectorContext): Promise<Credentials> {
  const token = ctx.credentials.accessToken;
  if (!token) throw new ConnectorError('AUTH_EXPIRED', 'No Instagram token stored; reconnect the account.');
  try {
    const { data } = await http<any>(ctx, `${INSTAGRAM_GRAPH}/refresh_access_token`, {
      query: { grant_type: 'ig_refresh_token', access_token: token },
      maxAttempts: 2,
    });
    return {
      ...ctx.credentials,
      accessToken: String(data.access_token),
      expiresAt: ctx.now() + Number(data.expires_in ?? 5_184_000) * 1000,
    };
  } catch (e) {
    if (e instanceof ConnectorError && (e.kind === 'BAD_REQUEST' || e.kind === 'AUTH_EXPIRED'))
      throw new ConnectorError(
        'AUTH_REVOKED',
        'Instagram rejected the token (expired or access revoked). Reconnect the account.',
        { status: e.status },
      );
    throw e;
  }
}

export async function fetchInstagramProfile(
  ctx: ConnectorContext,
  version = DEFAULT_GRAPH_VERSION,
): Promise<InstagramProfile> {
  const { data } = await http<any>(ctx, `${INSTAGRAM_GRAPH}/${version}/me`, {
    query: {
      fields: 'user_id,username,name,account_type,profile_picture_url,followers_count,media_count',
      access_token: ctx.credentials.accessToken,
    },
    maxAttempts: 2,
  });
  const id = data?.user_id ?? data?.id;
  if (!id) throw new ConnectorError('BAD_REQUEST', 'Instagram did not return an account id.');
  return {
    userId: String(id),
    username: data.username ?? null,
    name: data.name ?? null,
    accountType: data.account_type ?? null,
    profilePictureUrl: data.profile_picture_url ?? null,
    followersCount: data.followers_count ?? null,
    mediaCount: data.media_count ?? null,
  };
}

/** What each granted permission enables, and what the owner is still missing. Pure, easy to test. */
export function instagramCapabilityMatrix(granted: string[]) {
  const has = (s: string) => granted.includes(s);
  const flags = {
    profile: has(INSTAGRAM_SCOPES.basic),
    importMedia: has(INSTAGRAM_SCOPES.basic),
    insights: has(INSTAGRAM_SCOPES.basic),
    publish: has(INSTAGRAM_SCOPES.basic) && has(INSTAGRAM_SCOPES.publish),
    comments: has(INSTAGRAM_SCOPES.basic) && has(INSTAGRAM_SCOPES.comments),
    messages: has(INSTAGRAM_SCOPES.basic) && has(INSTAGRAM_SCOPES.messages),
  };
  const missing = INSTAGRAM_ALL_SCOPES.filter((s) => !granted.includes(s));
  return { flags, missing };
}

/** Meta signs webhook bodies with HMAC-SHA256 of the raw bytes using the app secret: header `X-Hub-Signature-256: sha256=...`. */
export function verifyMetaSignature(rawBody: string | Buffer, header: string | undefined, secret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice(7), 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function isGraphUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && p.hostname === 'graph.instagram.com' && !p.username && !p.port;
  } catch {
    return false;
  }
}

interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  thumbnail_url?: string;
}

export class InstagramLoginConnector implements Connector<NormalizedPost, IgMedia> {
  readonly id = 'instagram' as const;

  private client(ctx: ConnectorContext): InstagramClientConfig | null {
    return (ctx.config.instagramClient as InstagramClientConfig | undefined) ?? null;
  }
  private version(ctx: ConnectorContext) {
    return this.client(ctx)?.graphVersion ?? DEFAULT_GRAPH_VERSION;
  }

  async getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const client = this.client(ctx);
    const connected = Boolean(ctx.credentials.accessToken);
    const granted = ctx.credentials.scopes ?? [];
    const { flags, missing } = instagramCapabilityMatrix(connected ? granted : []);
    const blockers: string[] = [];
    if (!client)
      blockers.push(
        'Instagram app is not configured (INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_REDIRECT_URI).',
      );
    if (connected && missing.length)
      blockers.push(
        `Not granted: ${missing.join(', ')}. Reconnect and approve them. Outside your own test users, Meta App Review (Advanced Access) and Business Verification are required for these permissions.`,
      );
    blockers.push(
      'Direct messages can only be answered inside Meta’s 24 hour window after the customer’s last message; CreatorOS never sends automatically.',
    );
    return {
      provider: 'instagram',
      state: connected ? 'ACTIVE' : 'NOT_CONFIGURED',
      read: connected && flags.importMedia,
      write: connected && flags.publish,
      incrementalSync: connected && flags.importMedia,
      flags: { ...flags, connected },
      blockers,
      setupSteps: [
        'Create a Meta app, add the “Instagram” product and choose “API setup with Instagram login”.',
        'Add your Instagram professional account as an Instagram tester and accept the invite in Instagram settings.',
        'Copy the Instagram app ID/secret (not the Facebook app ID) into INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET.',
        'Add the redirect URI shown in Integrations to “Business login settings”, set INSTAGRAM_REDIRECT_URI, restart, then Connect.',
      ],
    };
  }

  async connect(ctx: ConnectorContext, input: Record<string, any> = {}): Promise<ConnectResult> {
    const client = this.client(ctx);
    if (!client) return { status: 'NOT_CONFIGURED', steps: (await this.getCapabilities(ctx)).setupSteps };
    const scopes: string[] = [INSTAGRAM_SCOPES.basic];
    if (input.publish !== false) scopes.push(INSTAGRAM_SCOPES.publish);
    if (input.comments !== false) scopes.push(INSTAGRAM_SCOPES.comments);
    if (input.messages !== false) scopes.push(INSTAGRAM_SCOPES.messages);
    const state = randomState();
    return {
      status: 'REDIRECT',
      authorizeUrl: buildInstagramAuthUrl({ client, scopes, state, forceReauth: input.reconnect === true }),
      oauth: { state, verifier: '', scopes },
    };
  }

  /** Meta offers no token revocation endpoint for Instagram Login; the owner removes the app in Instagram settings. */
  async disconnect() {}

  refreshCredentials(ctx: ConnectorContext): Promise<Credentials> {
    return refreshInstagramToken(ctx);
  }

  async health(ctx: ConnectorContext): Promise<HealthResult> {
    const checkedAt = new Date(ctx.now()).toISOString();
    try {
      if (!ctx.credentials.accessToken)
        throw new ConnectorError('NOT_CONFIGURED', 'Instagram is not connected');
      await fetchInstagramProfile(ctx, this.version(ctx));
      return { ok: true, state: 'ACTIVE', checkedAt };
    } catch (e) {
      const err = e as ConnectorError;
      return {
        ok: false,
        state:
          err.kind === 'NOT_CONFIGURED'
            ? 'NOT_CONFIGURED'
            : err.kind === 'AUTH_EXPIRED' || err.kind === 'AUTH_REVOKED'
              ? 'AUTH_EXPIRED'
              : 'ERROR',
        detail: err.message,
        checkedAt,
      };
    }
  }

  async rateLimitBudget(): Promise<RateLimitBudget> {
    return { remaining: null, limit: null, resetsAt: null, estimated: true };
  }

  normalize(m: IgMedia): NormalizedPost {
    return {
      provider: 'instagram',
      externalId: m.id,
      url: m.permalink ?? null,
      title: null,
      description: m.caption ?? null,
      publishedAt: m.timestamp ?? null,
      durationMs: null,
      privacy: 'PUBLIC',
      state: 'PUBLISHED_VERIFIED',
      stats: { likes: m.like_count, comments: m.comments_count },
      thumbnailUrl: m.thumbnail_url ?? null,
      accountExternalId: null,
    };
  }

  async getExternalRecord(ctx: ConnectorContext, id: string): Promise<NormalizedPost | null> {
    try {
      const { data } = await http<IgMedia>(ctx, `${INSTAGRAM_GRAPH}/${this.version(ctx)}/${id}`, {
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
    if (!ctx.credentials.accessToken)
      throw new ConnectorError('NOT_CONFIGURED', 'Instagram is not connected');
    const items: NormalizedPost[] = [];
    let next: string | undefined = `${INSTAGRAM_GRAPH}/${this.version(ctx)}/me/media`;
    let query: Record<string, string> | undefined = {
      fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count,thumbnail_url',
      limit: '50',
      access_token: ctx.credentials.accessToken,
    };
    let newest: string | null = null;
    for (let pages = 0; next && pages < 40; pages++) {
      type Page = { data?: IgMedia[]; paging?: { next?: string } };
      const res: { data: Page } = await http<Page>(ctx, next, { query });
      let stop = false;
      for (const m of res.data.data ?? []) {
        if (stopBefore && m.timestamp && m.timestamp <= stopBefore) {
          stop = true;
          continue;
        }
        if (m.timestamp && (!newest || m.timestamp > newest)) newest = m.timestamp;
        items.push(this.normalize(m));
      }
      const candidate = stop ? undefined : res.data.paging?.next;
      // SSRF guard: only ever follow pagination links that stay on Instagram's Graph host over https.
      next = candidate && isGraphUrl(candidate) ? candidate : undefined;
      query = undefined;
    }
    return { items, nextCursor: newest ?? stopBefore ?? null, hasMore: false };
  }

  syncIncremental(ctx: ConnectorContext, cursor: string | null) {
    return this.syncFull(ctx, cursor);
  }
}

/* ------------------------------------------------------------------ messaging (endpoints UNVERIFIED against live docs) */

export interface InstagramSendResult {
  providerMessageId: string | null;
}

/**
 * Sends one text DM from the connected account to `recipientId` (an Instagram-scoped id).
 * The request is never retried automatically: a timeout after the request left means the message may have been
 * delivered, and the caller must record that as UNCERTAIN instead of sending again.
 */
export async function sendInstagramDm(
  ctx: ConnectorContext,
  args: { accountId: string; recipientId: string; text: string },
  version = DEFAULT_GRAPH_VERSION,
): Promise<InstagramSendResult> {
  if (!ctx.credentials.accessToken) throw new ConnectorError('AUTH_EXPIRED', 'Instagram is not connected');
  const { data } = await http<any>(
    ctx,
    `${INSTAGRAM_GRAPH}/${version}/${encodeURIComponent(args.accountId)}/messages`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.credentials.accessToken}` },
      json: { recipient: { id: args.recipientId }, message: { text: args.text } },
      maxAttempts: 1,
    },
  );
  return { providerMessageId: data?.message_id ?? data?.id ?? null };
}

export async function replyToInstagramComment(
  ctx: ConnectorContext,
  args: { commentId: string; text: string },
  version = DEFAULT_GRAPH_VERSION,
): Promise<InstagramSendResult> {
  if (!ctx.credentials.accessToken) throw new ConnectorError('AUTH_EXPIRED', 'Instagram is not connected');
  const { data } = await http<any>(
    ctx,
    `${INSTAGRAM_GRAPH}/${version}/${encodeURIComponent(args.commentId)}/replies`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.credentials.accessToken}` },
      json: { message: args.text },
      maxAttempts: 1,
    },
  );
  return { providerMessageId: data?.id ?? null };
}

export interface NormalizedSocialMessage {
  providerThreadId: string;
  providerMsgId: string;
  participantId: string;
  participantName: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
  receivedAt: string;
}

/** Lists recent DM conversations with their latest messages (read-only backfill; these are never live events). */
export async function listInstagramConversations(
  ctx: ConnectorContext,
  accountId: string,
  version = DEFAULT_GRAPH_VERSION,
): Promise<NormalizedSocialMessage[]> {
  if (!ctx.credentials.accessToken) throw new ConnectorError('AUTH_EXPIRED', 'Instagram is not connected');
  const { data } = await http<any>(ctx, `${INSTAGRAM_GRAPH}/${version}/me/conversations`, {
    query: {
      platform: 'instagram',
      limit: '25',
      fields: 'id,participants,messages.limit(20){id,created_time,from,message}',
      access_token: ctx.credentials.accessToken,
    },
  });
  const out: NormalizedSocialMessage[] = [];
  for (const c of data?.data ?? []) {
    const other = (c.participants?.data ?? []).find((p: any) => String(p.id) !== accountId);
    for (const m of c.messages?.data ?? []) {
      if (!m?.id || typeof m.message !== 'string') continue;
      const fromMe = String(m.from?.id) === accountId;
      const who = fromMe ? other : m.from;
      out.push({
        providerThreadId: String(c.id),
        providerMsgId: String(m.id),
        participantId: String(who?.id ?? other?.id ?? 'unknown'),
        participantName: who?.username ?? who?.name ?? null,
        direction: fromMe ? 'OUTBOUND' : 'INBOUND',
        text: m.message,
        receivedAt: m.created_time,
      });
    }
  }
  return out;
}

/** Normalises a verified Instagram webhook entry into message/comment events. Unknown shapes are ignored, never guessed. */
export function parseInstagramWebhookEntry(entry: any): {
  accountId: string;
  mediaId: string | null;
  kind: 'DM' | 'COMMENT';
  providerThreadId: string;
  providerMsgId: string;
  participantId: string;
  participantName: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
  hasMedia: boolean;
  receivedAt: Date;
  link: string | null;
}[] {
  const accountId = entry?.id != null ? String(entry.id) : '';
  if (!accountId) return [];
  const out: ReturnType<typeof parseInstagramWebhookEntry> = [];
  for (const m of entry.messaging ?? []) {
    const mid = m?.message?.mid;
    if (!mid || m.message.is_deleted) continue;
    const echo = Boolean(m.message.is_echo);
    const participant = String(echo ? m.recipient?.id : m.sender?.id);
    if (!participant || participant === 'undefined') continue;
    out.push({
      accountId,
      mediaId: null,
      kind: 'DM',
      providerThreadId: `dm:${participant}`,
      providerMsgId: String(mid),
      participantId: participant,
      participantName: null,
      direction: echo ? 'OUTBOUND' : 'INBOUND',
      text: typeof m.message.text === 'string' ? m.message.text : '',
      hasMedia: Array.isArray(m.message.attachments) && m.message.attachments.length > 0,
      receivedAt: new Date(Number(m.timestamp) || Date.now()),
      link: null,
    });
  }
  // Some deliveries (including the dashboard's Test button) carry DMs as changes[field=messages] instead of messaging[].
  for (const ch of entry.changes ?? []) {
    const v = ch?.value;
    if (ch?.field !== 'messages' || !v?.message?.mid || v.message.is_deleted) continue;
    const echo = Boolean(v.message.is_echo);
    const participant = String(echo ? v.recipient?.id : v.sender?.id);
    if (!participant || participant === 'undefined') continue;
    out.push({
      accountId,
      mediaId: null,
      kind: 'DM',
      providerThreadId: `dm:${participant}`,
      providerMsgId: String(v.message.mid),
      participantId: participant,
      participantName: null,
      direction: echo ? 'OUTBOUND' : 'INBOUND',
      text: typeof v.message.text === 'string' ? v.message.text : '',
      hasMedia: Array.isArray(v.message.attachments) && v.message.attachments.length > 0,
      receivedAt: new Date(Number(v.timestamp) || Number(entry.time) * 1000 || Date.now()),
      link: null,
    });
  }
  for (const ch of entry.changes ?? []) {
    const v = ch?.value;
    if (ch?.field !== 'comments' || !v?.id) continue;
    const from = v.from?.id != null ? String(v.from.id) : '';
    if (!from) continue;
    const root = String(v.parent_id ?? v.id);
    out.push({
      accountId,
      mediaId: v.media?.id != null ? String(v.media.id) : null,
      kind: 'COMMENT',
      providerThreadId: `comment:${root}`,
      providerMsgId: String(v.id),
      participantId: from,
      participantName: v.from?.username ?? null,
      direction: from === accountId ? 'OUTBOUND' : 'INBOUND',
      text: typeof v.text === 'string' ? v.text : '',
      hasMedia: false,
      receivedAt: new Date(Number(entry.time) ? Number(entry.time) * 1000 : Date.now()),
      link: null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ paged reads (live-verified: profile, media, comments, conversations answered HTTP 200) */

const bearer = (ctx: ConnectorContext) => {
  if (!ctx.credentials.accessToken) throw new ConnectorError('AUTH_EXPIRED', 'Instagram is not connected');
  return { authorization: `Bearer ${ctx.credentials.accessToken}` };
};

export interface IgMediaItem {
  id: string;
  mediaType: string | null;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string | null;
  commentsCount: number;
}

export interface Page<T> {
  items: T[];
  after: string | null;
}

export async function listInstagramMediaPage(
  ctx: ConnectorContext,
  opts: { after?: string | null; limit?: number } = {},
  version = DEFAULT_GRAPH_VERSION,
): Promise<Page<IgMediaItem>> {
  const { data } = await http<any>(ctx, `${INSTAGRAM_GRAPH}/${version}/me/media`, {
    headers: bearer(ctx),
    query: {
      fields: 'id,caption,media_type,permalink,thumbnail_url,media_url,timestamp,comments_count',
      limit: String(opts.limit ?? 25),
      after: opts.after ?? undefined,
    },
  });
  return {
    items: (data?.data ?? []).map((m: any) => ({
      id: String(m.id),
      mediaType: m.media_type ?? null,
      caption: typeof m.caption === 'string' ? m.caption : null,
      permalink: m.permalink ?? null,
      thumbnailUrl: m.thumbnail_url ?? (m.media_type === 'IMAGE' ? (m.media_url ?? null) : null),
      timestamp: m.timestamp ?? null,
      commentsCount: Number(m.comments_count) || 0,
    })),
    after: data?.paging?.next ? (data?.paging?.cursors?.after ?? null) : null,
  };
}

export interface IgComment {
  id: string;
  rootId: string;
  text: string;
  username: string | null;
  fromId: string | null;
  timestamp: string;
}

/** One page of top-level comments, each with its replies flattened (replies carry the root id). */
export async function listInstagramCommentsPage(
  ctx: ConnectorContext,
  mediaId: string,
  opts: { after?: string | null; limit?: number } = {},
  version = DEFAULT_GRAPH_VERSION,
): Promise<Page<IgComment>> {
  const { data } = await http<any>(
    ctx,
    `${INSTAGRAM_GRAPH}/${version}/${encodeURIComponent(mediaId)}/comments`,
    {
      headers: bearer(ctx),
      query: {
        fields: 'id,text,username,timestamp,from,replies{id,text,username,timestamp,from}',
        limit: String(opts.limit ?? 25),
        after: opts.after ?? undefined,
      },
    },
  );
  const out: IgComment[] = [];
  for (const c of data?.data ?? []) {
    const one = (x: any, root: string) => {
      if (!x?.id || typeof x.text !== 'string') return;
      out.push({
        id: String(x.id),
        rootId: root,
        text: x.text,
        username: x.username ?? x.from?.username ?? null,
        fromId: x.from?.id != null ? String(x.from.id) : null,
        timestamp: x.timestamp,
      });
    };
    one(c, String(c.id));
    for (const r of c.replies?.data ?? []) one(r, String(c.id));
  }
  return { items: out, after: data?.paging?.next ? (data?.paging?.cursors?.after ?? null) : null };
}

export interface IgConversationPage {
  conversations: { id: string; updatedTime: string | null; messages: NormalizedSocialMessage[] }[];
  after: string | null;
}

export async function listInstagramConversationPage(
  ctx: ConnectorContext,
  accountId: string,
  opts: { after?: string | null; limit?: number } = {},
  version = DEFAULT_GRAPH_VERSION,
): Promise<IgConversationPage> {
  const { data } = await http<any>(ctx, `${INSTAGRAM_GRAPH}/${version}/me/conversations`, {
    headers: bearer(ctx),
    query: {
      platform: 'instagram',
      limit: String(opts.limit ?? 10),
      after: opts.after ?? undefined,
      fields: 'id,updated_time,participants,messages.limit(25){id,created_time,from,to,message}',
    },
  });
  const conversations = (data?.data ?? []).map((c: any) => {
    const other = (c.participants?.data ?? []).find((p: any) => String(p.id) !== accountId);
    const messages: NormalizedSocialMessage[] = [];
    for (const m of c.messages?.data ?? []) {
      if (!m?.id || typeof m.message !== 'string') continue;
      const fromMe = String(m.from?.id) === accountId;
      const who = fromMe ? other : m.from;
      messages.push({
        providerThreadId: String(c.id),
        providerMsgId: String(m.id),
        participantId: String(who?.id ?? other?.id ?? 'unknown'),
        participantName: who?.username ?? who?.name ?? null,
        direction: fromMe ? 'OUTBOUND' : 'INBOUND',
        text: m.message,
        receivedAt: m.created_time,
      });
    }
    return { id: String(c.id), updatedTime: c.updated_time ?? null, messages };
  });
  return { conversations, after: data?.paging?.next ? (data?.paging?.cursors?.after ?? null) : null };
}
