import {
  and,
  conversationThreads,
  eq,
  messages,
  providerConnections,
  socialOutboundMessages,
  sql,
} from '@creatoros/db';
import { ConnectorError, GOOGLE_SCOPES, gmailConnector, type ConnectorContext } from '@creatoros/connectors';
import { audit } from './audit';
import { encrypt } from './crypto';
import { ingestMessage, mailCounts } from './crm';
import { connectorContext } from './integrations';
import { createThreadCollaboration, updateThreadLocal } from './socials-ops';
import { badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const MAIL = { mail: true } as const;
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** Connected mailboxes with their own tab counts, so the Inbox can offer a named account picker. */
export async function mailAccounts(ctx: Ctx) {
  const conns = await ctx.db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.orgId, ctx.orgId), eq(providerConnections.provider, 'gmail')));
  const accounts = [];
  for (const c of conns) {
    const counts = await mailCounts(ctx, { connectionId: c.id });
    accounts.push({
      id: c.id,
      label: c.principalHint ?? 'Gmail account',
      email: c.principalHint,
      state: c.state,
      canSend: c.scopes.includes(GOOGLE_SCOPES.gmailSend[0]),
      lastSyncAt: c.lastSyncAt,
      counts,
    });
  }
  const [manual] = rowsOf<{ n: number }>(
    await ctx.db.execute(
      sql`select count(*)::int as n from conversation_threads where org_id = ${ctx.orgId} and provider_connection_id is null and source not in ('INSTAGRAM','FACEBOOK','TIKTOK','YOUTUBE') and merged_into_id is null`,
    ),
  );
  return { accounts, manualCount: manual?.n ?? 0, totals: await mailCounts(ctx) };
}

/**
 * Moves an email conversation between tabs. Archive/Inbox only change Creator OS (nothing is archived in Gmail);
 * Pipeline confirms it as a collaboration lead, which creates the opportunity exactly once.
 */
export async function moveMailThread(ctx: Ctx, id: string, to: 'INBOX' | 'ARCHIVE' | 'PIPELINE') {
  const [t] = await ctx.db
    .select()
    .from(conversationThreads)
    .where(and(eq(conversationThreads.id, id), eq(conversationThreads.orgId, ctx.orgId)));
  if (!t) throw notFound('Conversation');
  if (to === 'ARCHIVE') {
    await updateThreadLocal(ctx, id, { archivedLocal: true }, MAIL);
    return { id, to, localOnly: true };
  }
  if (to === 'PIPELINE') {
    if (t.archivedLocal) await updateThreadLocal(ctx, id, { archivedLocal: false }, MAIL);
    const r = await createThreadCollaboration(ctx, id, {}, MAIL);
    return { id, to, opportunityId: r.opportunityId };
  }
  if (t.triageState === 'CONFIRMED')
    throw conflict(
      'This conversation is in your pipeline. Close or decline the opportunity there instead.',
      undefined,
      'IN_PIPELINE',
    );
  await updateThreadLocal(ctx, id, { archivedLocal: false }, MAIL);
  if (t.triageState === 'DISMISSED')
    await ctx.db
      .update(conversationThreads)
      .set({ triageState: 'POSSIBLE', updatedAt: new Date() })
      .where(eq(conversationThreads.id, id));
  return { id, to, localOnly: true };
}

/** Errors where Gmail clearly did not send. Anything else (network, timeout, 5xx) is UNCERTAIN. */
const REFUSED = new Set([
  'NOT_CONFIGURED',
  'AUTH_EXPIRED',
  'AUTH_REVOKED',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'NOT_FOUND',
  'BAD_REQUEST',
]);

const stripRe = (s: string) => s.replace(/^\s*((re|aw|sv)\s*:\s*)+/i, '').trim();

/** Splits an address header on commas that are not inside quotes, and keeps only the e-mail part. */
function addrList(v: string | null | undefined): string[] {
  if (!v) return [];
  return v
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((p) => {
      const m = /<([^>]+)>/.exec(p);
      return (m?.[1] ?? p).trim().toLowerCase();
    })
    .filter((e) => EMAIL_RE.test(e));
}

const uniq = (xs: string[]) => [...new Set(xs)];

async function loadMailContext(ctx: Ctx, threadId: string) {
  const [t] = await ctx.db
    .select()
    .from(conversationThreads)
    .where(and(eq(conversationThreads.id, threadId), eq(conversationThreads.orgId, ctx.orgId)));
  if (!t || t.source !== 'GMAIL') throw notFound('Email conversation');
  if (!t.providerConnectionId || !t.providerThreadId || !t.principal)
    throw conflict('This email has no connected Gmail account to send from.', undefined, 'NO_IDENTITY');
  const [conn] = await ctx.db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, t.providerConnectionId), eq(providerConnections.orgId, ctx.orgId)));
  if (!conn || conn.state === 'PAUSED' || conn.state === 'DISABLED')
    throw conflict(
      'The Gmail account for this conversation is not active.',
      undefined,
      'CONNECTION_INACTIVE',
    );
  const msgs = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(sql`${messages.receivedAt} desc`);
  return { t, conn, msgs };
}

/**
 * Who a reply to ONE specific message goes to. Reply: the sender (Reply-To if set); for a message you sent, its recipients.
 * Reply all: also the other To and all Cc addresses. Your own address is always removed. Uses Gmail's live headers
 * (the stored copy has no Cc), falling back to what was stored if Gmail cannot be reached.
 */
async function resolveReply(
  ctx: Ctx,
  base: Awaited<ReturnType<typeof loadMailContext>>,
  messageId: string | undefined,
  all: boolean,
  overrides: Partial<ConnectorContext>,
) {
  const { t, conn, msgs } = base;
  const target = messageId
    ? msgs.find((m) => m.id === messageId)
    : (msgs.find((m) => m.direction === 'INBOUND') ?? msgs[0]);
  if (!target) throw notFound('Message');
  const me = (conn.principalHint ?? '').toLowerCase();
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  let h: Awaited<ReturnType<typeof gmailConnector.getReplyHeaders>> | null = null;
  if (target.providerMsgId) {
    try {
      h = await gmailConnector.getReplyHeaders(cctx, target.providerMsgId);
    } catch {
      /* fall back to the stored copy below; threading headers are best effort */
    }
  }
  const fromList = addrList(h?.from).length ? addrList(h?.from) : target.fromEmail ? [target.fromEmail] : [];
  const toList = addrList(h?.to).length ? addrList(h?.to) : target.toEmails;
  const ccList = addrList(h?.cc);
  const inbound = target.direction === 'INBOUND';
  const primary = inbound ? (addrList(h?.replyTo).length ? addrList(h?.replyTo) : fromList) : toList;
  let to = primary;
  let cc: string[] = [];
  if (all) {
    to = inbound ? uniq([...primary, ...toList]) : primary;
    cc = ccList;
  }
  to = uniq(to.filter((e) => e !== me));
  cc = uniq(cc.filter((e) => e !== me && !to.includes(e)));
  return {
    target,
    to,
    cc,
    subject: `Re: ${stripRe(target.subject ?? t.subject ?? '') || '(no subject)'}`,
    inReplyTo: h?.messageId ?? null,
    references: h?.references ?? null,
    from: conn.principalHint,
  };
}

/** Prefill for the reply panel (nothing is sent). */
export async function replyInfo(
  ctx: Ctx,
  threadId: string,
  messageId: string,
  all: boolean,
  overrides: Partial<ConnectorContext> = {},
) {
  const base = await loadMailContext(ctx, threadId);
  const r = await resolveReply(ctx, base, messageId, all, overrides);
  return {
    to: r.to,
    cc: r.cc,
    subject: r.subject,
    from: r.from,
    messageId: r.target.id,
    canSend: base.conn.scopes.includes(GOOGLE_SCOPES.gmailSend[0]),
  };
}

/**
 * Loads the complete text of one email from Gmail and stores it (encrypted), replacing the short snippet the sync keeps.
 * Read-only on Gmail.
 */
export async function loadFullMessage(
  ctx: Ctx,
  threadId: string,
  messageId: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const base = await loadMailContext(ctx, threadId);
  const m = base.msgs.find((x) => x.id === messageId);
  if (!m || !m.providerMsgId) throw notFound('Message');
  const cctx = connectorContext(ctx.db, ctx.env, base.conn, overrides);
  const full = await gmailConnector.getFullMessage(cctx, m.providerMsgId);
  if (!full) throw notFound('Message in Gmail (it may have been deleted)');
  const body = full.bodyText ?? full.snippet;
  await ctx.db
    .update(messages)
    .set({
      bodyEnc: encrypt(body, ctx.env.encryptionKey),
      bodyPreview: body.replace(/\s+/g, ' ').slice(0, 500),
      attachmentRefs: full.attachments,
    })
    .where(eq(messages.id, m.id));
  return { id: m.id, body, attachments: full.attachments };
}

/**
 * Sends a reply to one specific message from the connected Gmail account, in the same Gmail thread. Only on an explicit user
 * action: the caller supplies `requestId`, a repeat of the same id never sends twice, and a send is never retried (a network
 * failure leaves it UNCERTAIN so the owner checks Sent mail instead of risking a duplicate).
 */
export async function replyToEmail(
  ctx: Ctx,
  threadId: string,
  input: {
    text: string;
    requestId: string;
    messageId?: string;
    all?: boolean;
    to?: string[];
    cc?: string[];
    subject?: string;
  },
  overrides: Partial<ConnectorContext> = {},
) {
  const text = input.text.replace(/\r\n/g, '\n').trim();
  if (!text) throw badRequest('Write a reply first.');
  if (text.length > 20000) throw badRequest('The reply is too long.');
  const given = (xs: string[] | undefined) => (xs ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const e of [...given(input.to), ...given(input.cc)])
    if (!EMAIL_RE.test(e)) throw badRequest(`"${e}" is not a valid email address.`);

  const base = await loadMailContext(ctx, threadId);
  const { t, conn } = base;
  if (!conn.scopes.includes(GOOGLE_SCOPES.gmailSend[0]))
    throw conflict(
      'Sending is not enabled for this Gmail account. Open Integrations, choose "Enable sending" and approve the new permission.',
      undefined,
      'SEND_NOT_GRANTED',
    );
  const r = await resolveReply(ctx, base, input.messageId, input.all ?? false, overrides);
  const me = (conn.principalHint ?? '').toLowerCase();
  const to = input.to?.length ? uniq(given(input.to)) : r.to;
  const cc = input.to?.length ? uniq(given(input.cc)) : input.cc ? uniq(given(input.cc)) : r.cc;
  if (!to.length) throw badRequest('Could not work out who to reply to. Enter a recipient.');
  if (to.every((e) => e === me)) throw badRequest('That would send the reply only to your own address.');
  const subject = input.subject?.trim() || r.subject;
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);

  const ins = await ctx.db
    .insert(socialOutboundMessages)
    .values({
      orgId: ctx.orgId,
      threadId,
      connectionId: conn.id,
      providerAccountId: t.principal!,
      recipientId: to.join(',').slice(0, 500),
      kind: 'EMAIL',
      body: text,
      state: 'SENDING',
      requestId: input.requestId,
      source: 'USER',
      createdBy: ctx.userId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!ins[0]) {
    const [prev] = await ctx.db
      .select()
      .from(socialOutboundMessages)
      .where(
        and(
          eq(socialOutboundMessages.orgId, ctx.orgId),
          eq(socialOutboundMessages.requestId, input.requestId),
        ),
      );
    return { id: prev!.id, state: prev!.state, to: prev!.recipientId, duplicate: true };
  }
  const row = ins[0];
  try {
    const sent = await gmailConnector.sendEmail(cctx, {
      to,
      cc,
      subject,
      body: text,
      threadId: t.providerThreadId!,
      inReplyTo: r.inReplyTo,
      references: r.references,
    });
    await ctx.db
      .update(socialOutboundMessages)
      .set({ state: 'SENT', providerMessageId: sent.id, sentAt: new Date(), updatedAt: new Date() })
      .where(eq(socialOutboundMessages.id, row.id));
    await ingestMessage(ctx, {
      source: 'GMAIL',
      principal: t.principal,
      providerThreadId: t.providerThreadId,
      providerMsgId: sent.id,
      direction: 'OUTBOUND',
      receivedAt: new Date(),
      fromEmail: conn.principalHint,
      toEmails: [...to, ...cc],
      subject,
      body: text,
      providerConnectionId: conn.id,
    });
    await audit(ctx, 'mail.reply.sent', { type: 'thread', id: threadId }, undefined, {
      outboundId: row.id,
      to,
      cc,
      inReplyToMessage: r.target.id,
    });
    return { id: row.id, state: 'SENT' as const, to: to.join(', '), duplicate: false };
  } catch (e) {
    const definite = e instanceof ConnectorError && REFUSED.has(e.kind);
    const msg = (e as Error).message.slice(0, 300);
    await ctx.db
      .update(socialOutboundMessages)
      .set({ state: definite ? 'FAILED' : 'UNCERTAIN', error: msg, updatedAt: new Date() })
      .where(eq(socialOutboundMessages.id, row.id));
    await audit(ctx, 'mail.reply.failed', { type: 'thread', id: threadId }, undefined, {
      state: definite ? 'FAILED' : 'UNCERTAIN',
    });
    throw conflict(
      definite
        ? `Gmail refused the reply: ${msg}`
        : `The reply may or may not have been sent (${msg}). Check Sent in Gmail before trying again.`,
      undefined,
      definite ? 'SEND_FAILED' : 'SEND_UNCERTAIN',
    );
  }
}
