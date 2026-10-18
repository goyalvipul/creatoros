import { and, eq, expenses, invoiceSuggestions, sql } from '@creatoros/db';
import { extractInvoiceHints } from '@creatoros/domain';
import { audit } from './audit';
import { createInvoice } from './crm';
import { decrypt } from './crypto';
import { badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

/**
 * Reads stored email bodies and records invoice-looking ones as SUGGESTIONS. Nothing becomes an invoice or expense until the
 * owner accepts it. Messages that already have a suggestion (accepted or dismissed) are never suggested again.
 * Only email text is read: PDF attachments are not opened, so an invoice that exists only inside a PDF is not found.
 */
export async function scanEmailInvoices(
  ctx: Ctx,
  q: { connectionId?: string; days?: number; limit?: number } = {},
) {
  const days = Math.min(Math.max(q.days ?? 365, 1), 3650);
  const limit = Math.min(Math.max(q.limit ?? 3000, 1), 10000);
  const rows = rowsOf<{
    id: string;
    thread_id: string;
    connection_id: string | null;
    direction: 'INBOUND' | 'OUTBOUND';
    received_at: Date;
    from_name: string | null;
    from_email: string | null;
    subject: string | null;
    body_enc: string | null;
    body_preview: string | null;
    attachment_refs: { name?: string }[] | null;
  }>(
    await ctx.db.execute(sql`
      select m.id, m.thread_id, t.provider_connection_id as connection_id, m.direction, m.received_at, m.from_name, m.from_email,
             m.subject, m.body_enc, m.body_preview, m.attachment_refs
      from messages m join conversation_threads t on t.id = m.thread_id
      where m.org_id = ${ctx.orgId}
        and t.source in ('GMAIL','MANUAL','OTHER')
        and m.received_at > now() - (${days}::int * interval '1 day')
        ${q.connectionId ? sql`and t.provider_connection_id = ${q.connectionId}::uuid` : sql``}
        and not exists (select 1 from invoice_suggestions s where s.message_id = m.id)
      order by m.received_at desc limit ${limit}`),
  );
  let found = 0;
  for (const m of rows) {
    let body = m.body_preview ?? '';
    if (m.body_enc) {
      try {
        body = decrypt(m.body_enc, ctx.env.encryptionKey);
      } catch {
        /* keep the preview */
      }
    }
    const hint = extractInvoiceHints({
      subject: m.subject,
      body,
      direction: m.direction,
      attachmentNames: (m.attachment_refs ?? []).map((a) => a.name ?? ''),
    });
    if (!hint) continue;
    if (
      await insertInvoiceSuggestion(ctx, {
        orgId: ctx.orgId,
        messageId: m.id,
        threadId: m.thread_id,
        connectionId: m.connection_id,
        invoiceNo: hint.invoiceNo,
        amountMinor: hint.amountMinor,
        currency: hint.currency,
        dueAt: hint.dueDate ? new Date(`${hint.dueDate}T12:00:00Z`) : null,
        direction: hint.direction,
        counterparty: m.direction === 'INBOUND' ? (m.from_name ?? m.from_email) : null,
        subject: m.subject?.slice(0, 300) ?? null,
        confidence: hint.confidence,
        signals: hint.signals,
      })
    )
      found += 1;
  }
  return { scanned: rows.length, found };
}

export async function listInvoiceSuggestions(
  ctx: Ctx,
  q: { status?: 'SUGGESTED' | 'ACCEPTED' | 'DISMISSED'; threadId?: string; limit?: number } = {},
) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select s.id, s.thread_id as "threadId", s.message_id as "messageId", s.invoice_no as "invoiceNo", s.amount_minor::float8 as "amountMinor",
             s.currency, s.due_at as "dueAt", s.direction, s.counterparty, s.subject, s.confidence, s.signals, s.status,
             s.accepted_invoice_id as "invoiceId", s.accepted_expense_id as "expenseId", m.received_at as "receivedAt",
             t.principal as mailbox, t.external_link as "externalLink"
      from invoice_suggestions s
      join messages m on m.id = s.message_id join conversation_threads t on t.id = s.thread_id
      where s.org_id = ${ctx.orgId} and s.status = ${q.status ?? 'SUGGESTED'}
        ${q.threadId ? sql`and s.thread_id = ${q.threadId}::uuid` : sql``}
      order by m.received_at desc limit ${Math.min(q.limit ?? 200, 500)}`),
  );
}

export async function acceptInvoiceSuggestion(
  ctx: Ctx,
  id: string,
  input: {
    as: 'INVOICE' | 'EXPENSE';
    invoiceNo?: string | null;
    amountMinor?: number;
    currency?: string;
    dueAt?: Date | string | null;
    dealId?: string | null;
    notes?: string | null;
  },
) {
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(invoiceSuggestions)
      .where(and(eq(invoiceSuggestions.id, id), eq(invoiceSuggestions.orgId, ctx.orgId)))
      .for('update');
    if (!s) throw notFound('Invoice suggestion');
    if (s.status !== 'SUGGESTED')
      throw conflict('This suggestion was already handled.', undefined, 'ALREADY_HANDLED');
    const amountMinor = input.amountMinor ?? s.amountMinor;
    if (!amountMinor || amountMinor <= 0) throw badRequest('Enter the amount before adding it.');
    const currency = (input.currency ?? s.currency ?? 'CAD').toUpperCase();
    const [m0] = (await tx.execute(sql`select received_at from messages where id = ${s.messageId}`)).rows as {
      received_at: Date | string;
    }[];
    const receivedAt = m0 ? new Date(m0.received_at) : null;
    const sub = s.subject ? `Email: ${s.subject}` : 'From an email';
    const stx = { ...ctx, db: tx };
    let patch: { acceptedInvoiceId?: string; acceptedExpenseId?: string };
    if (input.as === 'INVOICE') {
      const inv = await createInvoice(stx, {
        invoiceNo: (input.invoiceNo ?? s.invoiceNo)?.trim() || undefined,
        amountMinor,
        currency,
        issuedAt: receivedAt,
        dueAt: input.dueAt === undefined ? s.dueAt : input.dueAt,
        dealId: input.dealId ?? null,
        notes: input.notes ?? sub,
      });
      patch = { acceptedInvoiceId: inv.id };
    } else {
      const [exp] = await tx
        .insert(expenses)
        .values({
          orgId: ctx.orgId,
          dealId: input.dealId ?? null,
          description: [s.counterparty, s.invoiceNo ?? input.invoiceNo].filter(Boolean).join(' · ') || sub,
          amountMinor,
          currency,
          incurredAt: receivedAt ?? new Date(),
          notes: input.notes ?? sub,
        })
        .returning();
      patch = { acceptedExpenseId: exp!.id };
    }
    await tx
      .update(invoiceSuggestions)
      .set({ status: 'ACCEPTED', updatedAt: new Date(), ...patch })
      .where(eq(invoiceSuggestions.id, id));
    await audit(stx, 'invoice.suggestion.accept', { type: 'invoice_suggestion', id }, undefined, {
      as: input.as,
      ...patch,
    });
    return { id, status: 'ACCEPTED' as const, ...patch };
  });
}

export async function dismissInvoiceSuggestion(ctx: Ctx, id: string) {
  const r = await ctx.db
    .update(invoiceSuggestions)
    .set({ status: 'DISMISSED', updatedAt: new Date() })
    .where(
      and(
        eq(invoiceSuggestions.id, id),
        eq(invoiceSuggestions.orgId, ctx.orgId),
        eq(invoiceSuggestions.status, 'SUGGESTED'),
      ),
    )
    .returning({ id: invoiceSuggestions.id });
  if (!r.length) throw notFound('Open invoice suggestion');
  await audit(ctx, 'invoice.suggestion.dismiss', { type: 'invoice_suggestion', id });
  return { id, status: 'DISMISSED' as const };
}

/**
 * Records one suggestion unless this thread already has one for the same invoice (same number, or same amount and currency).
 * Replies quote earlier mail, so without this one invoice would be suggested once per reply.
 */
export async function insertInvoiceSuggestion(
  ctx: Ctx,
  row: typeof invoiceSuggestions.$inferInsert,
): Promise<boolean> {
  const dup = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`
      select id from invoice_suggestions where thread_id = ${row.threadId}::uuid and (
        ${row.invoiceNo ? sql`invoice_no = ${row.invoiceNo}` : sql`false`}
        or (${row.amountMinor ?? null}::bigint is not null and amount_minor = ${row.amountMinor ?? null}::bigint and currency is not distinct from ${row.currency ?? null})
      ) limit 1`),
  );
  if (dup.length) return false;
  const ins = await ctx.db
    .insert(invoiceSuggestions)
    .values(row)
    .onConflictDoNothing()
    .returning({ id: invoiceSuggestions.id });
  return ins.length > 0;
}
