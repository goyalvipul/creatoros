import {
  and,
  conversationThreads,
  desc,
  eq,
  messages,
  providerConnections,
  socialOutboundMessages,
  sql,
  type Db,
} from '@creatoros/db';
import {
  ConnectorError,
  INSTAGRAM_SCOPES,
  listInstagramConversations,
  readInstagramClientConfig,
  replyToInstagramComment,
  sendInstagramDm,
  type ConnectorContext,
} from '@creatoros/connectors';
import { dmWindowOpen, isOptOut } from '@creatoros/domain';
import { audit } from './audit';
import { connectorContext } from './integrations';
import { ingestMessage } from './crm';
import { decrypt, sha256Hex } from './crypto';
import { AppError, badRequest, conflict, notFound, systemCtx, type Ctx, type ServiceEnv } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
type Conn = typeof providerConnections.$inferSelect;
type Thread = typeof conversationThreads.$inferSelect;
type Outbound = typeof socialOutboundMessages.$inferSelect;

export const SOCIAL_SOURCES = ['INSTAGRAM', 'FACEBOOK', 'TIKTOK'] as const;
export const PLATFORM_NAMES: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
};

/** Per-account automation settings live on the connection. A newly connected account sends nothing automatically. */
export interface AccountSocialSettings {
  autoSendEnabled: boolean;
  dailySendCap: number;
  perContactCooldownHours: number;
  nickname: string | null;
  signature: string | null;
  defaultLanguage: string | null;
  tone: string | null;
  savedReplies: { id: string; title: string; text: string }[];
}

export function accountSettings(conn: Pick<Conn, 'config'>): AccountSocialSettings {
  const s = ((conn.config ?? {}) as any).social ?? {};
  return {
    autoSendEnabled: s.autoSendEnabled === true,
    dailySendCap: Number.isInteger(s.dailySendCap) ? s.dailySendCap : 50,
    perContactCooldownHours: Number.isInteger(s.perContactCooldownHours) ? s.perContactCooldownHours : 24,
    nickname: s.nickname ?? null,
    signature: s.signature ?? null,
    defaultLanguage: s.defaultLanguage ?? null,
    tone: s.tone ?? null,
    savedReplies: Array.isArray(s.savedReplies) ? s.savedReplies.slice(0, 50) : [],
  };
}

export type CapabilityStatus =
  | 'AVAILABLE'
  | 'MISSING_PERMISSION'
  | 'NOT_IMPLEMENTED'
  | 'UNSUPPORTED'
  | 'NEEDS_RECONNECT'
  | 'NOT_CONFIGURED';

/** Honest per-account capability model. `AVAILABLE` only when the permission is granted AND the feature is built. */
export function instagramCapabilities(conn: Conn, env: ServiceEnv) {
  const granted = conn.scopes ?? [];
  const live = conn.state === 'ACTIVE' || conn.state === 'PARTIAL_SYNC';
  const need = (scope: string): CapabilityStatus =>
    !live ? 'NEEDS_RECONNECT' : granted.includes(scope) ? 'AVAILABLE' : 'MISSING_PERMISSION';
  const webhooks: CapabilityStatus = readInstagramClientConfig(env.processEnv)?.webhookVerifyToken
    ? 'AVAILABLE'
    : 'NOT_CONFIGURED';
  return {
    readMessages: need(INSTAGRAM_SCOPES.messages),
    sendMessages: need(INSTAGRAM_SCOPES.messages),
    readComments: need(INSTAGRAM_SCOPES.comments),
    replyComments: need(INSTAGRAM_SCOPES.comments),
    webhooks,
    publishing:
      live && granted.includes(INSTAGRAM_SCOPES.publish)
        ? ('NOT_IMPLEMENTED' as const)
        : need(INSTAGRAM_SCOPES.publish),
    insights: 'NOT_IMPLEMENTED' as CapabilityStatus,
    mentions: 'NOT_IMPLEMENTED' as CapabilityStatus,
  };
}

async function loadConnection(db: Db, orgId: string, id: string): Promise<Conn> {
  const [c] = await db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, id), eq(providerConnections.orgId, orgId)));
  if (!c || c.provider !== 'instagram') throw notFound('Social account');
  return c;
}

/** Connected social accounts with identity, capabilities, settings and real inbox counts. */
export async function listSocialAccounts(ctx: Ctx) {
  const conns = await ctx.db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.orgId, ctx.orgId), eq(providerConnections.provider, 'instagram')));
  const counts = rowsOf<{ id: string; need: number; unread: number }>(
    await ctx.db.execute(sql`
      select t.provider_connection_id as id,
             count(*) filter (where t.state = 'NEED_REPLY' and t.triage_state <> 'DISMISSED')::int as need,
             coalesce(sum((select count(*) from messages m where m.thread_id = t.id and m.direction = 'INBOUND' and not m.is_read)), 0)::int as unread
      from conversation_threads t
      where t.org_id = ${ctx.orgId} and t.source in ('INSTAGRAM','FACEBOOK','TIKTOK') and t.merged_into_id is null
      group by t.provider_connection_id`),
  );
  return conns
    .filter((c) => c.state !== 'NOT_CONFIGURED' || c.encryptedTokenRef)
    .map((c) => {
      const cfg = (c.config ?? {}) as Record<string, any>;
      const n = counts.find((x) => x.id === c.id);
      return {
        id: c.id,
        platform: 'INSTAGRAM',
        accountId: c.principalHint,
        username: cfg.username ?? null,
        label: c.label,
        profilePictureUrl: cfg.profilePictureUrl ?? null,
        state: c.state,
        lastError: c.lastError,
        expiresAt: c.expiresAt,
        settings: accountSettings(c),
        capabilities: instagramCapabilities(c, ctx.env),
        needReply: n?.need ?? 0,
        unread: n?.unread ?? 0,
      };
    });
}

export async function updateAccountSettings(
  ctx: Ctx,
  connectionId: string,
  patch: Partial<Omit<AccountSocialSettings, 'savedReplies'>> & {
    savedReplies?: { id: string; title: string; text: string }[];
  },
) {
  const conn = await loadConnection(ctx.db, ctx.orgId, connectionId);
  const prev = accountSettings(conn);
  const next = { ...prev, ...patch };
  if (next.dailySendCap < 0 || next.dailySendCap > 1000) throw badRequest('dailySendCap must be 0-1000');
  if (next.perContactCooldownHours < 0 || next.perContactCooldownHours > 720)
    throw badRequest('perContactCooldownHours must be 0-720');
  await ctx.db
    .update(providerConnections)
    .set({ config: { ...(conn.config as object), social: next }, updatedAt: new Date() })
    .where(eq(providerConnections.id, conn.id));
  await audit(ctx, 'social.account.settings', { type: 'provider_connection', id: conn.id }, prev, next);
  return next;
}

// ------------------------------------------------------------------ intake

export interface SocialEvent {
  connectionId: string;
  kind: 'DM' | 'COMMENT';
  providerThreadId: string;
  providerMsgId: string;
  participantId: string;
  participantName?: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
  hasMedia?: boolean;
  receivedAt: Date;
  /** false for backfills and stale redeliveries: they are stored but never trigger automation. */
  isLive: boolean;
}

/**
 * Stores a provider message on a thread bound to the receiving account (`principal` = provider account id, plus the
 * connection id). The same provider message id under another account is a different message. Idempotent.
 */
export async function ingestSocialEvent(ctx: Ctx, ev: SocialEvent) {
  const conn = await loadConnection(ctx.db, ctx.orgId, ev.connectionId);
  const accountId = conn.principalHint;
  if (!accountId) throw badRequest('This connection has no provider account id; reconnect it.');
  const r = await ingestMessage(ctx, {
    source: 'INSTAGRAM',
    principal: accountId,
    providerThreadId: ev.providerThreadId,
    providerMsgId: ev.providerMsgId,
    direction: ev.direction,
    receivedAt: ev.receivedAt,
    fromName: ev.participantName ?? ev.participantId,
    body: ev.text,
    attachmentRefs: ev.hasMedia ? [{ name: 'media' }] : [],
    providerConnectionId: conn.id,
    provenance: 'VERIFIED_PLATFORM',
  });
  let isNewConversation = false;
  if (!r.duplicate) {
    const [{ n }] = rowsOf<{ n: number }>(
      await ctx.db.execute(sql`select count(*)::int as n from messages where thread_id = ${r.threadId}`),
    );
    isNewConversation = n === 1;
    const optOut = ev.direction === 'INBOUND' && isOptOut(ev.text);
    await ctx.db
      .update(conversationThreads)
      .set({
        participantId: ev.participantId,
        participantName: ev.participantName ?? sql`participant_name`,
        kind: ev.kind,
        optedOut: optOut ? true : sql`opted_out`,
        providerConnectionId: conn.id,
      } as any)
      .where(eq(conversationThreads.id, r.threadId));
  }
  return { ...r, isNewConversation, accountId };
}

/** Read-only backfill of recent DMs. Everything imported is marked historical so no automation runs on it. */
export async function syncSocialConversations(
  ctx: Ctx,
  connectionId: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const conn = await loadConnection(ctx.db, ctx.orgId, connectionId);
  if (!instagramCapabilities(conn, ctx.env).readMessages.startsWith('AVAILABLE'))
    throw conflict(
      'Reading messages is not available for this account (permission missing or reconnect needed).',
      undefined,
      'CAPABILITY_UNAVAILABLE',
    );
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  const version = readInstagramClientConfig(ctx.env.processEnv)?.graphVersion;
  const list = await listInstagramConversations(cctx, conn.principalHint!, version);
  let imported = 0;
  for (const m of list) {
    const r = await ingestSocialEvent(ctx, {
      connectionId: conn.id,
      kind: 'DM',
      providerThreadId: `dm:${m.participantId}`,
      providerMsgId: m.providerMsgId,
      participantId: m.participantId,
      participantName: m.participantName,
      direction: m.direction,
      text: m.text,
      receivedAt: new Date(m.receivedAt),
      isLive: false,
    });
    if (!r.duplicate) imported += 1;
  }
  return { fetched: list.length, imported };
}

// ------------------------------------------------------------------ reading

const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listSocialThreads(
  ctx: Ctx,
  q: {
    connectionIds?: string[];
    platform?: string;
    state?: string;
    kind?: string;
    q?: string;
    leads?: boolean;
    limit?: number;
  } = {},
) {
  const where = [
    sql`t.org_id = ${ctx.orgId}`,
    sql`t.merged_into_id is null`,
    sql`t.source in ('INSTAGRAM','FACEBOOK','TIKTOK')`,
  ];
  if (q.connectionIds?.length)
    where.push(
      sql`t.provider_connection_id in (${sql.join(
        q.connectionIds.map((i) => sql`${i}::uuid`),
        sql`, `,
      )})`,
    );
  if (q.platform) where.push(sql`t.source = ${q.platform}::message_source`);
  if (q.state) where.push(sql`t.state = ${q.state}::actionable_state`);
  if (q.kind) where.push(sql`t.kind = ${q.kind}`);
  if (q.leads)
    where.push(
      sql`(t.opportunity_id is not null or exists (select 1 from messages m join inbound_classifications c on c.message_id = m.id where m.thread_id = t.id and c.category = 'COLLABORATION'))`,
    );
  if (q.q?.trim()) {
    const like = '%' + esc(q.q.trim()) + '%';
    where.push(
      sql`(t.participant_name ilike ${like} or exists (select 1 from messages m where m.thread_id = t.id and m.body_preview ilike ${like}))`,
    );
  }
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select t.id, t.source as platform, t.kind, t.state, t.priority, t.labels, t.opted_out as "optedOut",
             t.provider_connection_id as "connectionId", t.principal as "accountId", c.label as "accountLabel",
             c.config->>'username' as "accountUsername", t.participant_id as "participantId", t.participant_name as "participantName",
             t.last_inbound_at as "lastInboundAt", t.last_outbound_at as "lastOutboundAt", t.opportunity_id as "opportunityId",
             (select m.body_preview from messages m where m.thread_id = t.id order by m.received_at desc limit 1) as preview,
             (select max(m.received_at) from messages m where m.thread_id = t.id) as "lastMessageAt",
             (select count(*)::int from messages m where m.thread_id = t.id and m.direction = 'INBOUND' and not m.is_read) as unread,
             (select cl.category from messages m join inbound_classifications cl on cl.message_id = m.id where m.thread_id = t.id order by cl.confidence desc limit 1) as category
      from conversation_threads t
      left join provider_connections c on c.id = t.provider_connection_id
      where ${sql.join(where, sql` and `)}
      order by (select max(m.received_at) from messages m where m.thread_id = t.id) desc nulls last
      limit ${Math.min(q.limit ?? 100, 300)}`),
  );
}

export function sendEligibility(
  thread: Pick<Thread, 'kind' | 'lastInboundAt' | 'optedOut'>,
  conn: Conn,
  now: Date,
  env: ServiceEnv,
): { canSend: boolean; reasons: string[]; windowOpen: boolean | null } {
  const reasons: string[] = [];
  const caps = instagramCapabilities(conn, env);
  const cap = thread.kind === 'COMMENT' ? caps.replyComments : caps.sendMessages;
  if (cap !== 'AVAILABLE')
    reasons.push(
      cap === 'MISSING_PERMISSION'
        ? `This account has not granted the ${thread.kind === 'COMMENT' ? 'comments' : 'messages'} permission. Reconnect and approve it.`
        : 'This account needs to be reconnected.',
    );
  let windowOpen: boolean | null = null;
  if (thread.kind !== 'COMMENT') {
    windowOpen = dmWindowOpen(thread.lastInboundAt, now);
    if (!windowOpen) reasons.push('The 24 hour reply window for this conversation has closed.');
  }
  return { canSend: reasons.length === 0, reasons, windowOpen };
}

export async function getSocialThread(ctx: Ctx, id: string) {
  const [t] = await ctx.db
    .select()
    .from(conversationThreads)
    .where(and(eq(conversationThreads.id, id), eq(conversationThreads.orgId, ctx.orgId)));
  if (!t || !SOCIAL_SOURCES.includes(t.source as any)) throw notFound('Conversation');
  const conn = t.providerConnectionId
    ? (
        await ctx.db
          .select()
          .from(providerConnections)
          .where(eq(providerConnections.id, t.providerConnectionId))
      )[0]
    : undefined;
  const msgs = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.threadId, id))
    .orderBy(messages.receivedAt);
  const outbound = await ctx.db
    .select()
    .from(socialOutboundMessages)
    .where(eq(socialOutboundMessages.threadId, id))
    .orderBy(desc(socialOutboundMessages.createdAt))
    .limit(50);
  const cfg = (conn?.config ?? {}) as Record<string, any>;
  return {
    id: t.id,
    platform: t.source,
    kind: t.kind,
    state: t.state,
    priority: t.priority,
    labels: t.labels,
    optedOut: t.optedOut,
    opportunityId: t.opportunityId,
    // The identity a reply will be sent from. Fixed by the conversation; the client cannot choose another.
    replyAs: conn
      ? {
          connectionId: conn.id,
          accountId: t.principal,
          username: cfg.username ?? null,
          label: conn.label,
          state: conn.state,
        }
      : null,
    replyTo: { participantId: t.participantId, name: t.participantName },
    eligibility: conn
      ? sendEligibility(t, conn, ctx.now(), ctx.env)
      : {
          canSend: false,
          reasons: ['The account for this conversation is no longer connected.'],
          windowOpen: null,
        },
    messages: msgs.map((m) => ({
      id: m.id,
      direction: m.direction,
      receivedAt: m.receivedAt,
      from: m.fromName,
      text: m.bodyEnc ? decrypt(m.bodyEnc, ctx.env.encryptionKey) : (m.bodyPreview ?? ''),
      isRead: m.isRead,
      attachments: m.attachmentRefs,
    })),
    outbound: outbound.map((o) => ({
      id: o.id,
      state: o.state,
      kind: o.kind,
      body: o.body,
      source: o.source,
      error: o.error,
      providerMessageId: o.providerMessageId,
      createdAt: o.createdAt,
      sentAt: o.sentAt,
    })),
  };
}

export async function markThreadRead(ctx: Ctx, id: string) {
  await ctx.db.execute(
    sql`update messages set is_read = true where thread_id = ${id} and org_id = ${ctx.orgId} and not is_read`,
  );
  return { ok: true };
}

// ------------------------------------------------------------------ sending

export interface SendResult {
  id: string;
  state: Outbound['state'];
  error: string | null;
  providerMessageId: string | null;
}

/**
 * The only code path that talks to a provider to send. It re-validates identity, permission, eligibility and
 * duplicate state at execution time and never depends on what the client or a queued job believed earlier.
 *  - DRAFT -> SENDING is an atomic claim, so concurrent callers cannot both send.
 *  - Definite failures (4xx, rate limit, auth) -> FAILED. Ambiguous ones (timeout, 5xx) -> UNCERTAIN, never auto-retried.
 */
export async function sendOutbound(
  db: Db,
  env: ServiceEnv,
  outboundId: string,
  overrides: Partial<ConnectorContext> = {},
): Promise<SendResult> {
  const out = (r: Outbound): SendResult => ({
    id: r.id,
    state: r.state,
    error: r.error,
    providerMessageId: r.providerMessageId,
  });
  const claimed = rowsOf<Outbound>(
    await db.execute(
      sql`update social_outbound_messages set state = 'SENDING', updated_at = now() where id = ${outboundId} and state = 'DRAFT' returning id`,
    ),
  );
  const [row0] = await db
    .select()
    .from(socialOutboundMessages)
    .where(eq(socialOutboundMessages.id, outboundId));
  if (!row0) throw notFound('Outbound message');
  if (!claimed.length) return out(row0); // already sending/sent/failed: never send twice
  const fail = async (state: 'FAILED' | 'UNCERTAIN', error: string) => {
    const [r] = await db
      .update(socialOutboundMessages)
      .set({ state, error: error.slice(0, 500), updatedAt: new Date() })
      .where(eq(socialOutboundMessages.id, outboundId))
      .returning();
    return out(r!);
  };

  const [thread] = await db
    .select()
    .from(conversationThreads)
    .where(eq(conversationThreads.id, row0.threadId));
  const [conn] = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.id, row0.connectionId));
  if (!thread || !conn) return fail('FAILED', 'Conversation or account no longer exists.');
  // identity lock: every link in the chain must agree
  if (
    conn.provider !== 'instagram' ||
    thread.providerConnectionId !== conn.id ||
    thread.principal !== row0.providerAccountId ||
    conn.principalHint !== row0.providerAccountId ||
    thread.participantId !== row0.recipientId ||
    conn.orgId !== row0.orgId ||
    thread.orgId !== row0.orgId
  )
    return fail(
      'FAILED',
      'IDENTITY_MISMATCH: sender account does not match the conversation. Nothing was sent.',
    );
  if (row0.source !== 'USER' && thread.optedOut)
    return fail('FAILED', 'The sender opted out of automated messages. Nothing was sent.');
  const elig = sendEligibility(thread, conn, new Date(), env);
  if (!elig.canSend) return fail('FAILED', elig.reasons.join(' '));
  if (conn.expiresAt && conn.expiresAt.getTime() < Date.now())
    return fail('FAILED', 'The Instagram token has expired. Reconnect the account.');

  const cctx = connectorContext(db, env, conn, overrides);
  const version = readInstagramClientConfig(env.processEnv)?.graphVersion;
  try {
    let providerMessageId: string | null;
    if (row0.kind === 'COMMENT_REPLY') {
      const [last] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.threadId, thread.id), eq(messages.direction, 'INBOUND')))
        .orderBy(desc(messages.receivedAt))
        .limit(1);
      if (!last?.providerMsgId) return fail('FAILED', 'No comment to reply to.');
      ({ providerMessageId } = await replyToInstagramComment(
        cctx,
        { commentId: last.providerMsgId, text: row0.body },
        version,
      ));
    } else {
      ({ providerMessageId } = await sendInstagramDm(
        cctx,
        { accountId: row0.providerAccountId, recipientId: row0.recipientId, text: row0.body },
        version,
      ));
    }
    const [r] = await db
      .update(socialOutboundMessages)
      .set({ state: 'SENT', providerMessageId, sentAt: new Date(), error: null, updatedAt: new Date() })
      .where(eq(socialOutboundMessages.id, outboundId))
      .returning();
    // record it in the conversation so state becomes WAITING and the reply shows in the history
    await ingestMessage(systemCtx({ db, env }, row0.orgId), {
      source: 'INSTAGRAM',
      principal: row0.providerAccountId,
      providerThreadId: thread.providerThreadId,
      providerMsgId: providerMessageId ?? `out:${row0.id}`,
      direction: 'OUTBOUND',
      receivedAt: new Date(),
      fromName: ((conn.config as any)?.username as string | undefined) ?? row0.providerAccountId,
      body: row0.body,
      providerConnectionId: conn.id,
      provenance: 'VERIFIED_PLATFORM',
    });
    return out(r!);
  } catch (e) {
    const err = e instanceof ConnectorError ? e : new ConnectorError('NETWORK', (e as Error).message);
    if (err.kind === 'AUTH_EXPIRED' || err.kind === 'AUTH_REVOKED')
      await db
        .update(providerConnections)
        .set({ state: 'AUTH_EXPIRED', lastError: err.message, updatedAt: new Date() })
        .where(eq(providerConnections.id, conn.id));
    const definite = [
      'RATE_LIMITED',
      'QUOTA_EXCEEDED',
      'AUTH_EXPIRED',
      'AUTH_REVOKED',
      'PERMISSION_DENIED',
      'BAD_REQUEST',
      'NOT_FOUND',
      'NOT_CONFIGURED',
    ].includes(err.kind);
    if (definite) return fail('FAILED', `${err.kind}: ${err.message}`);
    return fail(
      'UNCERTAIN',
      `Delivery unknown (${err.kind}). Check Instagram before sending again. ${err.message}`,
    );
  }
}

export async function createOutboundDraft(
  db: Db,
  input: {
    orgId: string;
    thread: Thread;
    kind: 'DM' | 'COMMENT_REPLY';
    body: string;
    requestId: string;
    source: 'USER' | 'WORKFLOW' | 'APPROVAL';
    createdBy?: string | null;
    executionId?: string | null;
  },
): Promise<{ row: Outbound; created: boolean }> {
  const t = input.thread;
  if (!t.providerConnectionId || !t.principal || !t.participantId)
    throw conflict('This conversation has no sending identity.', undefined, 'NO_IDENTITY');
  const inserted = await db
    .insert(socialOutboundMessages)
    .values({
      orgId: input.orgId,
      threadId: t.id,
      connectionId: t.providerConnectionId,
      providerAccountId: t.principal,
      recipientId: t.participantId,
      kind: input.kind,
      body: input.body,
      requestId: input.requestId,
      source: input.source,
      createdBy: input.createdBy ?? null,
      executionId: input.executionId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { row: inserted[0], created: true };
  const [existing] = await db
    .select()
    .from(socialOutboundMessages)
    .where(
      and(
        eq(socialOutboundMessages.orgId, input.orgId),
        eq(socialOutboundMessages.requestId, input.requestId),
      ),
    );
  return { row: existing!, created: false };
}

/**
 * Manual reply from the inbox. The sender is whatever account owns the conversation: `connectionId` is only a
 * confirmation of what the screen showed, and a mismatch is rejected by the server (409 IDENTITY_MISMATCH).
 */
export async function replyToThread(
  ctx: Ctx,
  threadId: string,
  input: { connectionId: string; text: string; requestId: string; send: boolean },
  overrides: Partial<ConnectorContext> = {},
) {
  const text = input.text.trim();
  if (!text || text.length > 1000) throw badRequest('Reply must be 1-1000 characters.');
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(input.requestId))
    throw badRequest('requestId must be 8-100 safe characters.');
  const [thread] = await ctx.db
    .select()
    .from(conversationThreads)
    .where(and(eq(conversationThreads.id, threadId), eq(conversationThreads.orgId, ctx.orgId)));
  if (!thread || !SOCIAL_SOURCES.includes(thread.source as any)) throw notFound('Conversation');
  if (thread.providerConnectionId !== input.connectionId)
    throw new AppError(
      409,
      'IDENTITY_MISMATCH',
      'This conversation belongs to a different connected account. Replies are always sent from the account that received the message.',
    );
  await loadConnection(ctx.db, ctx.orgId, input.connectionId);
  const { row, created } = await createOutboundDraft(ctx.db, {
    orgId: ctx.orgId,
    thread,
    kind: thread.kind === 'COMMENT' ? 'COMMENT_REPLY' : 'DM',
    body: text,
    requestId: input.requestId,
    source: 'USER',
    createdBy: ctx.userId,
  });
  if (row.threadId !== thread.id)
    throw conflict('requestId was already used for another conversation.', undefined, 'REQUEST_ID_REUSED');
  if (created)
    await audit(
      ctx,
      input.send ? 'social.reply.send' : 'social.reply.draft',
      { type: 'thread', id: thread.id },
      undefined,
      {
        connectionId: row.connectionId,
        providerAccountId: row.providerAccountId,
        recipientId: row.recipientId,
        textHash: sha256Hex(text).slice(0, 16),
      },
    );
  if (!input.send)
    return { id: row.id, state: row.state, error: row.error, providerMessageId: row.providerMessageId };
  return sendOutbound(ctx.db, ctx.env, row.id, overrides);
}
