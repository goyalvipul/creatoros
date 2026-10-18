import { ConnectorError, type ConnectorContext, type Credentials } from '../types';
import { http } from '../http';
import type { Page } from './instagram';

/**
 * Facebook Pages (Messenger inbox + Page post comments) via Facebook Login.
 * These permissions belong ONLY to this flow; Instagram Login scopes are separate (see instagram.ts).
 * Page access tokens obtained from a long-lived user token do not expire, but die if the user removes the app.
 */
export const FACEBOOK_SCOPES = {
  pages: 'pages_show_list',
  messaging: 'pages_messaging',
  metadata: 'pages_manage_metadata',
  readEngagement: 'pages_read_engagement',
  readContent: 'pages_read_user_content',
  engagement: 'pages_manage_engagement',
} as const;
export const FACEBOOK_ALL_SCOPES: string[] = Object.values(FACEBOOK_SCOPES);
export const FACEBOOK_GRAPH = 'https://graph.facebook.com';
export const FACEBOOK_WEBHOOK_FIELDS = ['messages', 'messaging_postbacks', 'message_reactions', 'feed'];

export interface FacebookClientConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  webhookVerifyToken?: string;
  graphVersion: string;
}

/** Needs the PARENT Meta app id/secret (App settings > Basic), not the Instagram app id/secret. */
export function readFacebookClientConfig(
  env: Record<string, string | undefined>,
): FacebookClientConfig | null {
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) return null;
  const base = (env.APP_BASE_URL ?? '').replace(/\/$/, '');
  const redirectUri =
    env.FACEBOOK_REDIRECT_URI || (base ? `${base}/api/v1/integrations/meta/facebook/callback` : '');
  if (!redirectUri) return null;
  return {
    appId: env.FACEBOOK_APP_ID,
    appSecret: env.FACEBOOK_APP_SECRET,
    redirectUri,
    webhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN || undefined,
    graphVersion: env.META_GRAPH_VERSION || 'v23.0',
  };
}

export function buildFacebookAuthUrl(args: {
  client: FacebookClientConfig;
  scopes: string[];
  state: string;
}) {
  const u = new URL(`https://www.facebook.com/${args.client.graphVersion}/dialog/oauth`);
  u.searchParams.set('client_id', args.client.appId);
  u.searchParams.set('redirect_uri', args.client.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', args.scopes.join(','));
  u.searchParams.set('state', args.state);
  return u.toString();
}

const v = (c: FacebookClientConfig) => `${FACEBOOK_GRAPH}/${c.graphVersion}`;
const bearer = (token: string | undefined) => {
  if (!token) throw new ConnectorError('AUTH_EXPIRED', 'Facebook is not connected');
  return { authorization: `Bearer ${token}` };
};

/** Code -> long-lived USER token (used once to read the Pages and their Page tokens, never stored). */
export async function exchangeFacebookCode(
  ctx: ConnectorContext,
  client: FacebookClientConfig,
  code: string,
): Promise<{ userToken: string; granted: string[]; declined: string[] }> {
  const { data } = await http<any>(ctx, `${v(client)}/oauth/access_token`, {
    query: {
      client_id: client.appId,
      client_secret: client.appSecret,
      redirect_uri: client.redirectUri,
      code,
    },
    maxAttempts: 1,
  });
  if (!data?.access_token)
    throw new ConnectorError('BAD_REQUEST', 'Facebook did not return an access token.');
  const long = await http<any>(ctx, `${v(client)}/oauth/access_token`, {
    query: {
      grant_type: 'fb_exchange_token',
      client_id: client.appId,
      client_secret: client.appSecret,
      fb_exchange_token: String(data.access_token),
    },
    maxAttempts: 1,
  });
  const userToken = String(long.data?.access_token ?? data.access_token);
  const perms = await http<any>(ctx, `${v(client)}/me/permissions`, { headers: bearer(userToken) });
  const rows: { permission: string; status: string }[] = perms.data?.data ?? [];
  return {
    userToken,
    granted: rows.filter((r) => r.status === 'granted').map((r) => r.permission),
    declined: rows.filter((r) => r.status !== 'granted').map((r) => r.permission),
  };
}

export interface FacebookPage {
  id: string;
  name: string;
  category: string | null;
  pageToken: string;
  tasks: string[];
  pictureUrl: string | null;
  link: string | null;
}

const PAGE_FIELDS = 'id,name,category,access_token,tasks,link,picture{url}';
const toPage = (p: any): FacebookPage => ({
  id: String(p.id),
  name: String(p.name ?? p.id),
  category: p.category ?? null,
  pageToken: String(p.access_token),
  tasks: Array.isArray(p.tasks) ? p.tasks : [],
  pictureUrl: p.picture?.data?.url ?? null,
  link: p.link ?? null,
});

/**
 * Pages the user granted, each with its own Page access token. `/me/accounts` is empty for Pages that belong to a
 * Business portfolio or were granted per-asset in the new login dialog, so fall back to the Pages named in the
 * token's granular scopes (read with the app token) and fetch each one directly.
 */
export async function listFacebookPages(
  ctx: ConnectorContext,
  client: FacebookClientConfig,
  userToken: string,
): Promise<FacebookPage[]> {
  const { data } = await http<any>(ctx, `${v(client)}/me/accounts`, {
    headers: bearer(userToken),
    query: { fields: PAGE_FIELDS, limit: '100' },
  });
  const direct: FacebookPage[] = (data?.data ?? []).filter((p: any) => p?.id && p?.access_token).map(toPage);
  if (direct.length) return direct;
  const dbg = await http<any>(ctx, `${v(client)}/debug_token`, {
    query: { input_token: userToken, access_token: `${client.appId}|${client.appSecret}` },
  });
  const ids = new Set<string>();
  for (const g of dbg.data?.data?.granular_scopes ?? [])
    if (String(g.scope).startsWith('pages_') || g.scope === 'business_management')
      for (const id of g.target_ids ?? []) ids.add(String(id));
  const out: FacebookPage[] = [];
  for (const id of ids) {
    try {
      const r = await http<any>(ctx, `${v(client)}/${encodeURIComponent(id)}`, {
        headers: bearer(userToken),
        query: { fields: PAGE_FIELDS },
      });
      if (r.data?.id && r.data?.access_token) out.push(toPage(r.data));
    } catch {
      // not a Page, or no access: skip
    }
  }
  return out;
}

export async function fetchFacebookPage(ctx: ConnectorContext, client: FacebookClientConfig, pageId: string) {
  const { data } = await http<any>(ctx, `${v(client)}/${encodeURIComponent(pageId)}`, {
    headers: bearer(ctx.credentials.accessToken),
    query: { fields: 'id,name,category,link,fan_count' },
  });
  return { id: String(data?.id ?? ''), name: String(data?.name ?? ''), fans: data?.fan_count ?? null };
}

/** POST subscribed_apps: only changes which events Meta sends to the webhook. */
export async function subscribeFacebookPage(
  ctx: ConnectorContext,
  client: FacebookClientConfig,
  pageId: string,
) {
  await http<any>(ctx, `${v(client)}/${encodeURIComponent(pageId)}/subscribed_apps`, {
    method: 'POST',
    headers: bearer(ctx.credentials.accessToken),
    query: { subscribed_fields: FACEBOOK_WEBHOOK_FIELDS.join(',') },
    maxAttempts: 1,
  });
  const { data } = await http<any>(ctx, `${v(client)}/${encodeURIComponent(pageId)}/subscribed_apps`, {
    headers: bearer(ctx.credentials.accessToken),
  });
  const fields = ((data?.data ?? []) as any[]).flatMap((a) => a.subscribed_fields ?? []);
  return {
    subscribed: fields as string[],
    missing: FACEBOOK_WEBHOOK_FIELDS.filter((f) => !fields.includes(f)),
  };
}

export interface FbMessage {
  providerMsgId: string;
  participantId: string;
  participantName: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
  hasMedia: boolean;
  receivedAt: string;
}
export interface FbConversationPage {
  conversations: { id: string; updatedTime: string | null; messages: FbMessage[] }[];
  after: string | null;
}

export async function listFacebookConversationPage(
  ctx: ConnectorContext,
  client: FacebookClientConfig,
  pageId: string,
  opts: { after?: string | null; limit?: number } = {},
): Promise<FbConversationPage> {
  const { data } = await http<any>(ctx, `${v(client)}/${encodeURIComponent(pageId)}/conversations`, {
    headers: bearer(ctx.credentials.accessToken),
    query: {
      platform: 'messenger',
      fields: 'id,updated_time,participants,messages.limit(25){id,created_time,from,message,attachments{id}}',
      limit: String(opts.limit ?? 25),
      after: opts.after ?? undefined,
    },
  });
  const conversations = (data?.data ?? []).map((c: any) => {
    const other = (c.participants?.data ?? []).find((p: any) => String(p.id) !== pageId);
    const msgs: FbMessage[] = [];
    for (const m of c.messages?.data ?? []) {
      const attachments = m.attachments?.data?.length ?? 0;
      if (!m?.id || (typeof m.message !== 'string' && !attachments)) continue;
      const fromPage = String(m.from?.id) === pageId;
      const who = fromPage ? other : m.from;
      msgs.push({
        providerMsgId: String(m.id),
        participantId: String(who?.id ?? other?.id ?? 'unknown'),
        participantName: who?.name ?? null,
        direction: fromPage ? 'OUTBOUND' : 'INBOUND',
        text: typeof m.message === 'string' ? m.message : '',
        hasMedia: attachments > 0,
        receivedAt: m.created_time,
      });
    }
    return { id: String(c.id), updatedTime: c.updated_time ?? null, messages: msgs };
  });
  return { conversations, after: data?.paging?.next ? (data?.paging?.cursors?.after ?? null) : null };
}

export interface FbPost {
  id: string;
  message: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  createdTime: string | null;
  commentsCount: number;
}

export async function listFacebookPostsPage(
  ctx: ConnectorContext,
  client: FacebookClientConfig,
  pageId: string,
  opts: { after?: string | null; limit?: number } = {},
): Promise<Page<FbPost>> {
  const { data } = await http<any>(ctx, `${v(client)}/${encodeURIComponent(pageId)}/published_posts`, {
    headers: bearer(ctx.credentials.accessToken),
    query: {
      fields: 'id,message,permalink_url,created_time,full_picture,comments.limit(0).summary(true)',
      limit: String(opts.limit ?? 25),
      after: opts.after ?? undefined,
    },
  });
  return {
    items: (data?.data ?? []).map((p: any) => ({
      id: String(p.id),
      message: p.message ?? null,
      permalink: p.permalink_url ?? null,
      thumbnailUrl: p.full_picture ?? null,
      createdTime: p.created_time ?? null,
      commentsCount: Number(p.comments?.summary?.total_count ?? 0),
    })),
    after: data?.paging?.next ? (data?.paging?.cursors?.after ?? null) : null,
  };
}

export interface FbComment {
  id: string;
  rootId: string;
  text: string;
  fromId: string | null;
  fromName: string | null;
  createdTime: string;
}

export async function listFacebookCommentsPage(
  ctx: ConnectorContext,
  client: FacebookClientConfig,
  postId: string,
  opts: { after?: string | null; limit?: number } = {},
): Promise<Page<FbComment>> {
  const { data } = await http<any>(ctx, `${v(client)}/${encodeURIComponent(postId)}/comments`, {
    headers: bearer(ctx.credentials.accessToken),
    query: {
      filter: 'stream', // every comment including replies, flat
      order: 'chronological',
      fields: 'id,message,from{id,name},created_time,parent{id}',
      limit: String(opts.limit ?? 50),
      after: opts.after ?? undefined,
    },
  });
  const items: FbComment[] = [];
  for (const c of data?.data ?? []) {
    if (!c?.id || typeof c.message !== 'string') continue;
    items.push({
      id: String(c.id),
      rootId: String(c.parent?.id ?? c.id),
      text: c.message,
      fromId: c.from?.id != null ? String(c.from.id) : null,
      fromName: c.from?.name ?? null,
      createdTime: c.created_time,
    });
  }
  return { items, after: data?.paging?.next ? (data?.paging?.cursors?.after ?? null) : null };
}

/** Sends one Messenger text from the Page. Never retried: a timeout may still have delivered it. */
export async function sendFacebookMessage(
  ctx: ConnectorContext,
  client: FacebookClientConfig,
  args: { pageId: string; recipientId: string; text: string },
): Promise<{ providerMessageId: string | null }> {
  const { data } = await http<any>(ctx, `${v(client)}/${encodeURIComponent(args.pageId)}/messages`, {
    method: 'POST',
    headers: bearer(ctx.credentials.accessToken),
    json: { recipient: { id: args.recipientId }, messaging_type: 'RESPONSE', message: { text: args.text } },
    maxAttempts: 1,
  });
  return { providerMessageId: data?.message_id ?? null };
}

export async function replyToFacebookComment(
  ctx: ConnectorContext,
  client: FacebookClientConfig,
  args: { commentId: string; text: string },
): Promise<{ providerMessageId: string | null }> {
  const { data } = await http<any>(ctx, `${v(client)}/${encodeURIComponent(args.commentId)}/comments`, {
    method: 'POST',
    headers: bearer(ctx.credentials.accessToken),
    json: { message: args.text },
    maxAttempts: 1,
  });
  return { providerMessageId: data?.id ?? null };
}

export interface FacebookWebhookEvent {
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
}

/** Normalises one verified Page webhook entry. Unknown shapes are ignored, never guessed. */
export function parseFacebookWebhookEntry(entry: any): FacebookWebhookEvent[] {
  const accountId = entry?.id != null ? String(entry.id) : '';
  if (!accountId) return [];
  const out: FacebookWebhookEvent[] = [];
  for (const m of entry.messaging ?? []) {
    const mid = m?.message?.mid;
    if (!mid || m.message.is_deleted) continue;
    const echo = Boolean(m.message.is_echo) || String(m.sender?.id) === accountId;
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
    });
  }
  for (const ch of entry.changes ?? []) {
    const val = ch?.value;
    if (ch?.field !== 'feed' || val?.item !== 'comment' || val?.verb !== 'add' || !val?.comment_id) continue;
    const from = val.from?.id != null ? String(val.from.id) : '';
    if (!from) continue;
    const root =
      val.parent_id && String(val.parent_id) !== String(val.post_id)
        ? String(val.parent_id)
        : String(val.comment_id);
    out.push({
      accountId,
      mediaId: val.post_id != null ? String(val.post_id) : null,
      kind: 'COMMENT',
      providerThreadId: `comment:${root}`,
      providerMsgId: String(val.comment_id),
      participantId: from,
      participantName: val.from?.name ?? null,
      direction: from === accountId ? 'OUTBOUND' : 'INBOUND',
      text: typeof val.message === 'string' ? val.message : '',
      hasMedia: false,
      receivedAt: new Date(Number(val.created_time) ? Number(val.created_time) * 1000 : Date.now()),
    });
  }
  return out;
}

export type { Credentials };
