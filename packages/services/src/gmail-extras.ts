import {
  inArray,
  and,
  conversationThreads,
  eq,
  invoiceSuggestions,
  messages,
  providerConnections,
  syncCursors,
} from '@creatoros/db';
import { gmailConnector, type ConnectorContext } from '@creatoros/connectors';
import { extractInvoiceHints } from '@creatoros/domain';
import { insertInvoiceSuggestion, scanEmailInvoices } from './invoice-suggestions';
import { encrypt } from './crypto';
import { ingestMessage } from './crm';
import { connectorContext } from './integrations';
import type { Ctx } from './types';

type Conn = typeof providerConnections.$inferSelect;

/**
 * Stars live on Gmail messages. The normal sync only looks at the last 90 days and only at new mail, so existing stars were
 * never seen. This asks Gmail directly for `is:starred` (ids only), marks those threads starred in Creator OS, and imports any
 * starred message we do not have yet. It only ever ADDS stars.
 */
export async function syncGmailStars(ctx: Ctx, conn: Conn, overrides: Partial<ConnectorContext> = {}) {
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  const found = await gmailConnector.searchIds(cctx, { query: 'is:starred -in:trash -in:spam', max: 1000 });
  let imported = 0;
  const threadIds = new Set<string>();
  for (const f of found) {
    const [have] = await ctx.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.orgId, ctx.orgId),
          eq(messages.source, 'GMAIL'),
          eq(messages.providerMsgId, f.id),
          eq(messages.principal, conn.principalHint ?? ''),
        ),
      );
    if (!have) {
      const m = await gmailConnector.getFullMessage(cctx, f.id);
      if (m) {
        const r = await ingestFull(ctx, conn, m);
        if (!r.duplicate) imported += 1;
      }
    }
    threadIds.add(f.threadId);
  }
  let marked = 0;
  for (const tid of threadIds) {
    const r = await ctx.db
      .update(conversationThreads)
      .set({ starred: true })
      .where(
        and(
          eq(conversationThreads.orgId, ctx.orgId),
          eq(conversationThreads.source, 'GMAIL'),
          eq(conversationThreads.providerThreadId, tid),
          eq(conversationThreads.principal, conn.principalHint ?? ''),
          eq(conversationThreads.starred, false),
        ),
      )
      .returning({ id: conversationThreads.id });
    marked += r.length;
  }
  return { starredInGmail: found.length, newlyStarred: marked, imported };
}

function ingestFull(
  ctx: Ctx,
  conn: Conn,
  m: Awaited<ReturnType<typeof gmailConnector.getFullMessage>> & object,
) {
  return ingestMessage(ctx, {
    source: 'GMAIL',
    principal: conn.principalHint,
    providerThreadId: m.providerThreadId,
    providerMsgId: m.providerMsgId,
    direction: m.direction,
    receivedAt: m.receivedAt,
    fromEmail: m.fromEmail,
    fromName: m.fromName,
    toEmails: m.toEmails,
    subject: m.subject,
    body: m.bodyText ?? m.snippet,
    attachmentRefs: m.attachments,
    providerConnectionId: conn.id,
    externalLink: `https://mail.google.com/mail/u/${encodeURIComponent(conn.principalHint ?? '0')}/#all/${m.providerThreadId}`,
  });
}

const INVOICE_QUERY =
  '(invoice OR "amount due" OR "balance due" OR "payment due" OR "tax invoice" OR filename:invoice) -in:chats -in:trash -in:spam';

/**
 * Dedicated invoice search. The normal sync skips older mail and promotions/updates, and stores only a ~200 character snippet,
 * which is too little to read an amount. Here every candidate message is fetched in full, its text and attachment names are
 * read, and a suggestion is recorded. Candidate mail that is new to Creator OS is stored as already-archived so the Inbox
 * is not flooded with receipts. The first run looks back two years; later runs only look at recent mail unless `deep`.
 */
export async function syncGmailInvoices(
  ctx: Ctx,
  conn: Conn,
  opts: { deep?: boolean; max?: number } = {},
  overrides: Partial<ConnectorContext> = {},
) {
  const scope = 'gmail.invoices';
  const [cur] = await ctx.db
    .select()
    .from(syncCursors)
    .where(and(eq(syncCursors.connectionId, conn.id), eq(syncCursors.scope, scope)));
  const since = !opts.deep && cur?.cursor ? Math.floor(Number(cur.cursor) / 1000) - 2 * 86400 : null;
  const startedAt = Date.now();
  const query = `${INVOICE_QUERY} ${since ? `after:${since}` : 'newer_than:730d'}`;
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  const ids = await gmailConnector.searchIds(cctx, { query, max: opts.max ?? 400 });
  let checked = 0;
  let found = 0;
  for (const f of ids) {
    const [existing] = await ctx.db
      .select({ id: messages.id, threadId: messages.threadId })
      .from(messages)
      .where(
        and(
          eq(messages.orgId, ctx.orgId),
          eq(messages.source, 'GMAIL'),
          eq(messages.providerMsgId, f.id),
          eq(messages.principal, conn.principalHint ?? ''),
        ),
      );
    if (existing) {
      const [done] = await ctx.db
        .select({ id: invoiceSuggestions.id })
        .from(invoiceSuggestions)
        .where(eq(invoiceSuggestions.messageId, existing.id));
      if (done) continue;
    }
    const m = await gmailConnector.getFullMessage(cctx, f.id);
    if (!m) continue;
    checked += 1;
    let messageId: string | null = existing?.id ?? null;
    let threadId: string | null = existing?.threadId ?? null;
    if (!existing) {
      const threadExisted =
        (
          await ctx.db
            .select({ id: conversationThreads.id })
            .from(conversationThreads)
            .where(
              and(
                eq(conversationThreads.orgId, ctx.orgId),
                eq(conversationThreads.source, 'GMAIL'),
                eq(conversationThreads.providerThreadId, m.providerThreadId),
                eq(conversationThreads.principal, conn.principalHint ?? ''),
              ),
            )
        ).length > 0;
      const r = await ingestFull(ctx, conn, m);
      messageId = r.messageId;
      threadId = r.threadId;
      if (!threadExisted && threadId)
        await ctx.db
          .update(conversationThreads)
          .set({ archivedLocal: true, state: 'DONE' })
          .where(eq(conversationThreads.id, threadId));
    } else if (m.bodyText) {
      // The stored copy came from the sync's snippet; replace it with the full text so it can be read.
      await ctx.db
        .update(messages)
        .set({
          bodyEnc: encrypt(m.bodyText, ctx.env.encryptionKey),
          bodyPreview: m.bodyText.replace(/\s+/g, ' ').slice(0, 500),
          attachmentRefs: m.attachments,
        })
        .where(eq(messages.id, existing.id));
    }
    if (!messageId || !threadId) continue;
    const hint = extractInvoiceHints({
      subject: m.subject,
      body: m.bodyText ?? m.snippet,
      direction: m.direction,
      attachmentNames: m.attachments.map((a) => a.name),
    });
    if (!hint) continue;
    if (
      await insertInvoiceSuggestion(ctx, {
        orgId: ctx.orgId,
        messageId,
        threadId,
        connectionId: conn.id,
        invoiceNo: hint.invoiceNo,
        amountMinor: hint.amountMinor,
        currency: hint.currency,
        dueAt: hint.dueDate ? new Date(`${hint.dueDate}T12:00:00Z`) : null,
        direction: hint.direction,
        counterparty: m.direction === 'INBOUND' ? (m.fromName ?? m.fromEmail) : null,
        subject: m.subject?.slice(0, 300) ?? null,
        confidence: hint.confidence,
        signals: hint.signals,
      })
    )
      found += 1;
  }
  await ctx.db
    .insert(syncCursors)
    .values({
      orgId: ctx.orgId,
      connectionId: conn.id,
      scope,
      cursor: String(startedAt),
      lastSuccessAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [syncCursors.connectionId, syncCursors.scope],
      set: { cursor: String(startedAt), lastSuccessAt: new Date(), updatedAt: new Date() },
    });
  return { candidates: ids.length, checked, found };
}

/** "Scan email now": Gmail-side deep search for invoices and stars on every active mailbox, then a pass over stored text. */
export async function deepScanEmail(
  ctx: Ctx,
  body: { connectionId?: string; days?: number },
  overrides: Partial<ConnectorContext> = {},
) {
  const conns = await ctx.db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.orgId, ctx.orgId),
        eq(providerConnections.provider, 'gmail'),
        inArray(providerConnections.state, ['ACTIVE', 'PARTIAL_SYNC']),
        ...(body.connectionId ? [eq(providerConnections.id, body.connectionId)] : []),
      ),
    );
  const gmail = { candidates: 0, checked: 0, found: 0, newlyStarred: 0, errors: [] as string[] };
  for (const c of conns) {
    try {
      const r = await syncGmailInvoices(ctx, c, { deep: true }, overrides);
      gmail.candidates += r.candidates;
      gmail.checked += r.checked;
      gmail.found += r.found;
      gmail.newlyStarred += (await syncGmailStars(ctx, c, overrides)).newlyStarred;
    } catch (e) {
      gmail.errors.push(`${c.principalHint ?? 'Gmail'}: ${(e as Error).message}`.slice(0, 200));
    }
  }
  return { ...(await scanEmailInvoices(ctx, body)), gmail };
}
