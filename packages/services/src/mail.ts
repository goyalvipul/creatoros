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

/**
 * Sends a reply from the connected Gmail account in the same Gmail thread. Only on an explicit user action: the caller supplies
 * `requestId`, a repeat of the same id never sends twice, and a send is never retried (a network failure leaves it UNCERTAIN so
 * the owner checks Sent mail instead of risking a duplicate).
 */
export async function replyToEmail(
  ctx: Ctx,
  threadId: string,
  input: { text: string; requestId: string; to?: string; subject?: string },
  overrides: Partial<ConnectorContext> = {},
) {
  const text = input.text.replace(/\r\n/g, '\n').trim();
  if (!text) throw badRequest('Write a reply first.');
  if (text.length > 20000) throw badRequest('The reply is too long.');
  if (input.to && !EMAIL_RE.test(input.to.trim()))
    throw badRequest('That recipient is not a valid email address.');

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
  if (!conn.scopes.includes(GOOGLE_SCOPES.gmailSend[0]))
    throw conflict(
      'Sending is not enabled for this Gmail account. Open Integrations, choose "Enable sending" and approve the new permission.',
      undefined,
      'SEND_NOT_GRANTED',
    );

  const msgs = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(sql`${messages.receivedAt} desc`);
  const lastIn = msgs.find((m) => m.direction === 'INBOUND');
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  let replyTo: string | null = null;
  let inReplyTo: string | null = null;
  let references: string | null = null;
  const anchor = lastIn ?? msgs[0];
  if (anchor?.providerMsgId) {
    try {
      const h = await gmailConnector.getReplyHeaders(cctx, anchor.providerMsgId);
      inReplyTo = h.messageId;
      references = h.references;
      replyTo = h.replyTo;
    } catch {
      /* threading headers are best effort; Gmail still keeps the reply in the thread via threadId */
    }
  }
  const addr = (v: string | null | undefined) => {
    const m = v ? /<([^>]+)>/.exec(v) : null;
    return (m?.[1] ?? v ?? '').trim().toLowerCase();
  };
  const to =
    input.to?.trim().toLowerCase() ||
    addr(replyTo) ||
    lastIn?.fromEmail ||
    (msgs.find((m) => m.direction === 'OUTBOUND')?.toEmails ?? [])[0];
  if (!to || !EMAIL_RE.test(to)) throw badRequest('Could not work out who to reply to. Enter a recipient.');
  if (to === conn.principalHint?.toLowerCase())
    throw badRequest('That would send the reply to your own address. Enter the recipient.');
  const subject = input.subject?.trim() || `Re: ${stripRe(t.subject ?? '') || '(no subject)'}`;

  const ins = await ctx.db
    .insert(socialOutboundMessages)
    .values({
      orgId: ctx.orgId,
      threadId,
      connectionId: conn.id,
      providerAccountId: t.principal,
      recipientId: to,
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
      to: [to],
      subject,
      body: text,
      threadId: t.providerThreadId,
      inReplyTo,
      references,
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
      toEmails: [to],
      subject,
      body: text,
      providerConnectionId: conn.id,
    });
    await audit(ctx, 'mail.reply.sent', { type: 'thread', id: threadId }, undefined, {
      outboundId: row.id,
      to,
    });
    return { id: row.id, state: 'SENT' as const, to, duplicate: false };
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
