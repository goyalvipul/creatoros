import {
  and,
  asc,
  contacts,
  conversationThreads,
  dealDeliverables,
  deals,
  desc,
  eq,
  expenses,
  externalOrganizations,
  fxRates,
  inboundClassifications,
  invoices,
  isNull,
  messages,
  opportunities,
  payments,
  sql,
  type Executor,
} from '@creatoros/db';
import { CLOSED_DEAL_STAGES, DEAL_STAGE, classifyMessage, deriveInvoiceStatus, type DealStage } from '@creatoros/domain';
import { audit, emit } from './audit';
import { decrypt, encrypt, sha256Hex } from './crypto';
import { badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ------------------------------------------------------------------ intake

export interface MessageInput {
  source: NonNullable<(typeof messages.$inferInsert)['source']>;
  principal?: string | null;
  providerThreadId?: string | null;
  providerMsgId?: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  receivedAt: Date | string;
  fromEmail?: string | null;
  fromName?: string | null;
  toEmails?: string[];
  subject?: string | null;
  body?: string | null;
  attachmentRefs?: { name: string; mime?: string; sizeBytes?: number; ref?: string }[];
  provenance?: 'VERIFIED_PLATFORM' | 'USER_ENTERED';
  providerConnectionId?: string | null;
  externalLink?: string | null;
}

/**
 * Idempotent message intake (Gmail sync, manual paste, imports). Same provider message or identical content in the same thread
 * is stored once. Inbound text is classified by deterministic rules into a *suggestion*; it can never create a deal by itself.
 */
export async function ingestMessage(ctx: Ctx, input: MessageInput) {
  const receivedAt = new Date(input.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) throw badRequest('Invalid receivedAt');
  const body = input.body ?? '';
  const checksum = sha256Hex([input.source, input.principal ?? '', input.providerMsgId ?? '', receivedAt.toISOString(), input.fromEmail ?? '', input.subject ?? '', body].join('\u0000'));
  return ctx.db.transaction(async (tx) => {
    // thread
    let thread: typeof conversationThreads.$inferSelect | undefined;
    if (input.providerThreadId) {
      [thread] = await tx
        .select()
        .from(conversationThreads)
        .where(and(eq(conversationThreads.orgId, ctx.orgId), eq(conversationThreads.source, input.source), eq(conversationThreads.providerThreadId, input.providerThreadId), input.principal ? eq(conversationThreads.principal, input.principal) : isNull(conversationThreads.principal)));
    }
    if (!thread) {
      [thread] = await tx
        .insert(conversationThreads)
        .values({ orgId: ctx.orgId, source: input.source, principal: input.principal ?? null, providerThreadId: input.providerThreadId ?? null, subject: input.subject ?? null, providerConnectionId: input.providerConnectionId ?? null, externalLink: input.externalLink ?? null, state: input.direction === 'INBOUND' ? 'NEED_REPLY' : 'WAITING_FOR_BRAND' })
        .onConflictDoNothing()
        .returning();
      if (!thread) {
        [thread] = await tx.select().from(conversationThreads).where(and(eq(conversationThreads.orgId, ctx.orgId), eq(conversationThreads.source, input.source), eq(conversationThreads.providerThreadId, input.providerThreadId!)));
      }
    }
    const [msg] = await tx
      .insert(messages)
      .values({
        orgId: ctx.orgId,
        threadId: thread!.id,
        source: input.source,
        principal: input.principal ?? null,
        providerMsgId: input.providerMsgId ?? null,
        direction: input.direction,
        receivedAt,
        fromEmail: input.fromEmail?.toLowerCase() ?? null,
        fromName: input.fromName ?? null,
        toEmails: input.toEmails ?? [],
        subject: input.subject ?? null,
        bodyPreview: body ? body.replace(/\s+/g, ' ').slice(0, 500) : null,
        bodyEnc: body ? encrypt(body, ctx.env.encryptionKey) : null,
        isRead: input.direction === 'OUTBOUND',
        attachmentRefs: input.attachmentRefs ?? [],
        rawChecksum: checksum,
        provenance: input.provenance ?? (input.source === 'MANUAL' ? 'USER_ENTERED' : 'VERIFIED_PLATFORM'),
      })
      .onConflictDoNothing()
      .returning();
    if (!msg) return { threadId: thread!.id, messageId: null, duplicate: true, classification: null };

    // thread state follows the newest message only (late/backfilled messages must not flip it)
    const newestBefore = Math.max(thread!.lastInboundAt?.getTime() ?? 0, thread!.lastOutboundAt?.getTime() ?? 0);
    const inbound = input.direction === 'INBOUND';
    const patch: Partial<typeof conversationThreads.$inferInsert> = {
      lastInboundAt: inbound && (!thread!.lastInboundAt || receivedAt > thread!.lastInboundAt) ? receivedAt : thread!.lastInboundAt,
      lastOutboundAt: !inbound && (!thread!.lastOutboundAt || receivedAt > thread!.lastOutboundAt) ? receivedAt : thread!.lastOutboundAt,
      subject: thread!.subject ?? input.subject ?? null,
      updatedAt: new Date(),
    };
    if (receivedAt.getTime() >= newestBefore) {
      if (inbound) {
        patch.state = 'NEED_REPLY';
        patch.snoozeUntil = null;
      } else {
        patch.state = 'WAITING_FOR_BRAND';
        patch.lastAnsweredAt = receivedAt;
      }
    }
    await tx.update(conversationThreads).set(patch).where(eq(conversationThreads.id, thread!.id));

    let classification: ReturnType<typeof classifyMessage> | null = null;
    if (inbound) {
      classification = classifyMessage({ subject: input.subject, body, fromEmail: input.fromEmail, fromName: input.fromName });
      await tx.insert(inboundClassifications).values({ orgId: ctx.orgId, messageId: msg.id, category: classification.category, extracted: classification.extracted as Record<string, unknown>, signals: classification.signals, confidence: classification.confidence }).onConflictDoNothing();
      if (classification.category === 'COLLABORATION') await emit(tx, ctx.orgId, 'deal.inquiry.detected', { threadId: thread!.id, messageId: msg.id, confidence: classification.confidence });
      if (thread!.opportunityId || thread!.dealId) await emit(tx, ctx.orgId, 'deal.reply_required', { threadId: thread!.id, dealId: thread!.dealId });
    }
    return { threadId: thread!.id, messageId: msg.id, duplicate: false, classification };
  });
}

export async function listThreads(ctx: Ctx, q: { state?: string; triage?: string; category?: string; q?: string; dealId?: string; limit?: number } = {}) {
  const where = [sql`t.org_id = ${ctx.orgId}`, sql`t.merged_into_id is null`];
  if (q.state) where.push(sql`t.state = ${q.state}::actionable_state`);
  if (q.triage) where.push(sql`t.triage_state = ${q.triage}::triage_state`);
  if (q.dealId) where.push(sql`t.deal_id = ${q.dealId}`);
  if (q.category) where.push(sql`exists (select 1 from messages m join inbound_classifications c on c.message_id = m.id where m.thread_id = t.id and c.category = ${q.category})`);
  if (q.q?.trim()) where.push(sql`(t.subject ilike ${'%' + esc(q.q.trim()) + '%'} or exists (select 1 from messages m where m.thread_id = t.id and (m.from_email ilike ${'%' + esc(q.q.trim()) + '%'} or m.body_preview ilike ${'%' + esc(q.q.trim()) + '%'})))`);
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select t.id, t.subject, t.source, t.state, t.triage_state as "triageState", t.last_inbound_at as "lastInboundAt", t.last_outbound_at as "lastOutboundAt",
             t.snooze_until as "snoozeUntil", t.opportunity_id as "opportunityId", t.deal_id as "dealId", t.external_link as "externalLink",
             (select m.from_email from messages m where m.thread_id = t.id and m.direction = 'INBOUND' order by m.received_at desc limit 1) as "fromEmail",
             (select m.body_preview from messages m where m.thread_id = t.id order by m.received_at desc limit 1) as preview,
             (select c.category from messages m join inbound_classifications c on c.message_id = m.id where m.thread_id = t.id order by c.confidence desc limit 1) as category,
             (select max(c.confidence) from messages m join inbound_classifications c on c.message_id = m.id where m.thread_id = t.id) as confidence
      from conversation_threads t where ${sql.join(where, sql` and `)}
      order by coalesce(t.last_inbound_at, t.last_outbound_at) desc nulls last limit ${Math.min(q.limit ?? 100, 500)}`),
  );
}

export async function getThread(ctx: Ctx, id: string, withBodies = true) {
  const [t] = await ctx.db.select().from(conversationThreads).where(and(eq(conversationThreads.id, id), eq(conversationThreads.orgId, ctx.orgId)));
  if (!t) throw notFound('Thread');
  const msgs = await ctx.db.select().from(messages).where(eq(messages.threadId, id)).orderBy(asc(messages.receivedAt));
  const cls = rowsOf<any>(await ctx.db.execute(sql`select c.* from inbound_classifications c join messages m on m.id = c.message_id where m.thread_id = ${id}`));
  return {
    ...t,
    messages: msgs.map(({ bodyEnc, ...m }) => ({ ...m, body: withBodies && bodyEnc ? safeDecrypt(bodyEnc, ctx) : null, classification: cls.find((c) => c.message_id === m.id) ?? null })),
  };
}

function safeDecrypt(enc: string, ctx: Ctx) {
  try {
    return decrypt(enc, ctx.env.encryptionKey);
  } catch {
    return null;
  }
}

export async function setThreadState(ctx: Ctx, id: string, state: 'NEED_REPLY' | 'WAITING_FOR_BRAND' | 'WAITING_FOR_USER' | 'DONE', snoozeUntil?: Date | null) {
  const [t] = await ctx.db
    .update(conversationThreads)
    .set({ state, snoozeUntil: snoozeUntil ?? null, lastAnsweredAt: state === 'DONE' ? new Date() : sql`${conversationThreads.lastAnsweredAt}`, updatedAt: new Date() })
    .where(and(eq(conversationThreads.id, id), eq(conversationThreads.orgId, ctx.orgId)))
    .returning();
  if (!t) throw notFound('Thread');
  await audit(ctx, 'thread.state', { type: 'thread', id }, undefined, { state, snoozeUntil });
  return t;
}

async function upsertExternalOrg(tx: Executor, ctx: Ctx, name: string | undefined | null) {
  const n = name?.trim();
  if (!n) return null;
  const [existing] = await tx.select().from(externalOrganizations).where(and(eq(externalOrganizations.orgId, ctx.orgId), sql`lower(${externalOrganizations.name}) = lower(${n})`, isNull(externalOrganizations.deletedAt)));
  if (existing) return existing;
  const [o] = await tx.insert(externalOrganizations).values({ orgId: ctx.orgId, name: n }).onConflictDoNothing().returning();
  if (o) return o;
  const [again] = await tx.select().from(externalOrganizations).where(and(eq(externalOrganizations.orgId, ctx.orgId), sql`lower(${externalOrganizations.name}) = lower(${n})`));
  return again!;
}

async function upsertContact(tx: Executor, ctx: Ctx, email: string | null | undefined, name: string | null | undefined, externalOrgId: string | null) {
  const e = email?.trim().toLowerCase();
  if (!e) return null;
  const [existing] = await tx.select().from(contacts).where(and(eq(contacts.orgId, ctx.orgId), sql`${contacts.emails} @> ARRAY[${e}]::text[]`, isNull(contacts.deletedAt)));
  if (existing) return existing;
  const [c] = await tx.insert(contacts).values({ orgId: ctx.orgId, name: name?.trim() || e, emails: [e], externalOrgId }).returning();
  return c!;
}

/**
 * Owner reviews a suggested collaboration. CONFIRMED creates one opportunity per thread (idempotent); DISMISSED hides it from the queue
 * without deleting anything; MERGED folds a duplicate thread into another.
 */
export async function triageThread(ctx: Ctx, threadId: string, outcome: 'CONFIRMED' | 'DISMISSED' | 'MERGED', opts: { mergeIntoId?: string; title?: string } = {}) {
  return ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(conversationThreads).where(and(eq(conversationThreads.id, threadId), eq(conversationThreads.orgId, ctx.orgId)));
    if (!t) throw notFound('Thread');
    const cls = rowsOf<any>(await tx.execute(sql`select c.* from inbound_classifications c join messages m on m.id = c.message_id where m.thread_id = ${threadId} order by c.confidence desc limit 1`))[0];
    if (outcome === 'DISMISSED') {
      await tx.update(conversationThreads).set({ triageState: 'DISMISSED', updatedAt: new Date() }).where(eq(conversationThreads.id, threadId));
      if (cls) await tx.execute(sql`update inbound_classifications set review_outcome = 'REJECTED', reviewed_by = ${ctx.userId}, reviewed_at = now() where id = ${cls.id}`);
      await audit({ ...ctx, db: tx }, 'thread.triage.dismiss', { type: 'thread', id: threadId });
      return { threadId, triageState: 'DISMISSED' as const };
    }
    if (outcome === 'MERGED') {
      if (!opts.mergeIntoId || opts.mergeIntoId === threadId) throw badRequest('mergeIntoId is required');
      const [target] = await tx.select().from(conversationThreads).where(and(eq(conversationThreads.id, opts.mergeIntoId), eq(conversationThreads.orgId, ctx.orgId)));
      if (!target) throw notFound('Target thread');
      await tx.update(conversationThreads).set({ triageState: 'MERGED', mergedIntoId: target.id, updatedAt: new Date() }).where(eq(conversationThreads.id, threadId));
      await audit({ ...ctx, db: tx }, 'thread.triage.merge', { type: 'thread', id: threadId }, undefined, { into: target.id });
      return { threadId, triageState: 'MERGED' as const };
    }
    const existing = t.opportunityId ? (await tx.select().from(opportunities).where(eq(opportunities.id, t.opportunityId)))[0] : undefined;
    if (existing) return { threadId, triageState: 'CONFIRMED' as const, opportunity: existing, alreadyConfirmed: true };
    const lastIn = rowsOf<any>(await tx.execute(sql`select from_email as "fromEmail", from_name as "fromName" from messages where thread_id = ${threadId} and direction = 'INBOUND' order by received_at desc limit 1`))[0];
    const x = (cls?.extracted ?? {}) as Record<string, any>;
    const org = await upsertExternalOrg(tx, ctx, x.brandGuess ?? lastIn?.fromName);
    const contact = await upsertContact(tx, ctx, lastIn?.fromEmail, lastIn?.fromName, org?.id ?? null);
    const [opp] = await tx
      .insert(opportunities)
      .values({ orgId: ctx.orgId, sourceThreadId: threadId, externalOrgId: org?.id ?? null, contactId: contact?.id ?? null, title: opts.title?.trim() || t.subject || `Opportunity from ${lastIn?.fromEmail ?? 'inbound'}`, offerType: (x.compensation as any) ?? 'UNKNOWN', stage: 'TRIAGE', predictedValueMinor: x.amountMinor ?? null, currency: x.currency ?? 'USD', createdBy: ctx.userId })
      .onConflictDoNothing()
      .returning();
    const opportunity = opp ?? (await tx.select().from(opportunities).where(eq(opportunities.sourceThreadId, threadId)))[0]!;
    await tx.update(conversationThreads).set({ triageState: 'CONFIRMED', opportunityId: opportunity.id, externalOrgId: org?.id ?? null, contactId: contact?.id ?? null, updatedAt: new Date() }).where(eq(conversationThreads.id, threadId));
    if (cls) await tx.execute(sql`update inbound_classifications set review_outcome = 'ACCEPTED', reviewed_by = ${ctx.userId}, reviewed_at = now() where id = ${cls.id}`);
    await audit({ ...ctx, db: tx }, 'thread.triage.confirm', { type: 'thread', id: threadId }, undefined, { opportunityId: opportunity.id });
    return { threadId, triageState: 'CONFIRMED' as const, opportunity, alreadyConfirmed: false };
  });
}

/** Manual collaboration intake: the owner types it in, so it is a confirmed opportunity immediately. */
export async function manualIntake(ctx: Ctx, input: { brand: string; contactName?: string; contactEmail?: string; subject: string; notes?: string; offerType?: (typeof opportunities.$inferInsert)['offerType']; valueMinor?: number | null; currency?: string; source?: NonNullable<(typeof messages.$inferInsert)['source']> }) {
  if (!input.brand?.trim() || !input.subject?.trim()) throw badRequest('Brand and subject are required');
  const res = await ingestMessage(ctx, { source: input.source ?? 'MANUAL', direction: 'INBOUND', receivedAt: new Date(), fromEmail: input.contactEmail ?? null, fromName: input.contactName ?? input.brand, subject: input.subject, body: input.notes ?? input.subject, provenance: 'USER_ENTERED' });
  return ctx.db.transaction(async (tx) => {
    const org = await upsertExternalOrg(tx, ctx, input.brand);
    const contact = await upsertContact(tx, ctx, input.contactEmail, input.contactName, org?.id ?? null);
    const [opp] = await tx.insert(opportunities).values({ orgId: ctx.orgId, sourceThreadId: res.threadId, externalOrgId: org?.id ?? null, contactId: contact?.id ?? null, title: input.subject.trim(), offerType: input.offerType ?? 'UNKNOWN', stage: 'TRIAGE', predictedValueMinor: input.valueMinor ?? null, currency: input.currency ?? 'USD', createdBy: ctx.userId, notes: input.notes ?? null }).returning();
    await tx.update(conversationThreads).set({ triageState: 'CONFIRMED', opportunityId: opp!.id, externalOrgId: org?.id ?? null, contactId: contact?.id ?? null }).where(eq(conversationThreads.id, res.threadId));
    await audit({ ...ctx, db: tx }, 'opportunity.create', { type: 'opportunity', id: opp!.id });
    return { opportunity: opp!, threadId: res.threadId };
  });
}

// -------------------------------------------------------------------- deals

export async function convertOpportunityToDeal(ctx: Ctx, opportunityId: string, input: { stage?: DealStage; title?: string; compensationType?: (typeof deals.$inferInsert)['compensationType']; contractedValueMinor?: number | null; currency?: string; paymentTermsDays?: number | null } = {}) {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from opportunities where id = ${opportunityId} for update`);
    const [o] = await tx.select().from(opportunities).where(and(eq(opportunities.id, opportunityId), eq(opportunities.orgId, ctx.orgId), isNull(opportunities.deletedAt)));
    if (!o) throw notFound('Opportunity');
    const [existing] = await tx.select().from(deals).where(and(eq(deals.opportunityId, opportunityId), isNull(deals.deletedAt)));
    if (existing) return { deal: existing, alreadyConverted: true };
    const stage = input.stage ?? 'QUALIFIED';
    const [d] = await tx
      .insert(deals)
      .values({ orgId: ctx.orgId, opportunityId, externalOrgId: o.externalOrgId, contactId: o.contactId, brandId: o.brandId, channelId: o.channelId, title: input.title?.trim() || o.title, stage, compensationType: input.compensationType ?? o.offerType, contractedValueMinor: input.contractedValueMinor ?? o.predictedValueMinor, currency: input.currency ?? o.currency, paymentTermsDays: input.paymentTermsDays ?? null, ownerUserId: ctx.userId })
      .returning();
    await tx.update(opportunities).set({ stage, updatedAt: new Date() }).where(eq(opportunities.id, opportunityId));
    if (o.sourceThreadId) await tx.update(conversationThreads).set({ dealId: d!.id }).where(eq(conversationThreads.id, o.sourceThreadId));
    await audit({ ...ctx, db: tx }, 'deal.create', { type: 'deal', id: d!.id }, undefined, { opportunityId });
    return { deal: d!, alreadyConverted: false };
  });
}

export async function createDeal(ctx: Ctx, input: Partial<typeof deals.$inferInsert> & { title: string }) {
  if (!input.title?.trim()) throw badRequest('Title is required');
  const [d] = await ctx.db.insert(deals).values({ ...input, id: undefined, orgId: ctx.orgId, title: input.title.trim(), ownerUserId: input.ownerUserId ?? ctx.userId, deletedAt: null, closedAt: null }).returning();
  await audit(ctx, 'deal.create', { type: 'deal', id: d!.id });
  return d!;
}

export async function updateDeal(ctx: Ctx, id: string, patch: Partial<typeof deals.$inferInsert>) {
  const { id: _i, orgId: _o, stage: _s, closedAt: _c, ...safe } = patch as any;
  const [before] = await ctx.db.select().from(deals).where(and(eq(deals.id, id), eq(deals.orgId, ctx.orgId), isNull(deals.deletedAt)));
  if (!before) throw notFound('Deal');
  const [after] = await ctx.db.update(deals).set({ ...safe, updatedAt: new Date() }).where(eq(deals.id, id)).returning();
  await audit(ctx, 'deal.update', { type: 'deal', id }, before, after);
  return after!;
}

export async function changeDealStage(ctx: Ctx, id: string, to: DealStage, opts: { reason?: string; force?: boolean } = {}) {
  if (!DEAL_STAGE.includes(to)) throw badRequest(`Unknown stage ${to}`);
  return ctx.db.transaction(async (tx) => {
    const [d] = await tx.select().from(deals).where(and(eq(deals.id, id), eq(deals.orgId, ctx.orgId), isNull(deals.deletedAt)));
    if (!d) throw notFound('Deal');
    if (d.stage === to) return d;
    if (to === 'PAID_CLOSED' && !opts.force) {
      const [o] = rowsOf<{ due: number }>(await tx.execute(sql`select coalesce(sum(amount_minor - paid_total_minor),0)::float8 as due from invoices where deal_id = ${id} and status not in ('VOID','DRAFT')`));
      if ((o?.due ?? 0) > 0) throw conflict('There are unpaid invoices on this deal.', { dueMinor: o!.due }, 'UNPAID_INVOICES');
    }
    const closed = CLOSED_DEAL_STAGES.includes(to);
    const [after] = await tx.update(deals).set({ stage: to, stageChangedAt: new Date(), closedAt: closed ? new Date() : null, updatedAt: new Date() }).where(eq(deals.id, id)).returning();
    if (d.opportunityId) await tx.update(opportunities).set({ stage: to, updatedAt: new Date() }).where(eq(opportunities.id, d.opportunityId));
    if (to === 'APPROVED') await emit(tx, ctx.orgId, 'deal.approval_received', { dealId: id });
    await audit({ ...ctx, db: tx }, 'deal.stage', { type: 'deal', id }, { stage: d.stage }, { stage: to, reason: opts.reason });
    return after!;
  });
}

export async function addDeliverable(ctx: Ctx, dealId: string, input: Partial<typeof dealDeliverables.$inferInsert> & { title: string }) {
  const [d] = await ctx.db.select({ id: deals.id }).from(deals).where(and(eq(deals.id, dealId), eq(deals.orgId, ctx.orgId)));
  if (!d) throw notFound('Deal');
  const [x] = await ctx.db.insert(dealDeliverables).values({ ...input, id: undefined, orgId: ctx.orgId, dealId, status: 'PLANNED', approvedAt: null, submittedAt: null, approvalEvidence: null, approvalConfirmedBy: null }).returning();
  return x!;
}

/** Approval is NEVER inferred from an email: the owner must confirm and record the evidence. */
export async function setDeliverableStatus(ctx: Ctx, id: string, status: (typeof dealDeliverables.$inferInsert)['status'], opts: { evidence?: string } = {}) {
  const [x] = await ctx.db.select().from(dealDeliverables).where(and(eq(dealDeliverables.id, id), eq(dealDeliverables.orgId, ctx.orgId)));
  if (!x) throw notFound('Deliverable');
  if ((status === 'APPROVED' || status === 'ACCEPTED') && !opts.evidence?.trim()) throw badRequest('Approval needs evidence (e.g. the date and who approved, or a link/quote).', undefined, 'EVIDENCE_REQUIRED');
  const [after] = await ctx.db
    .update(dealDeliverables)
    .set({
      status,
      submittedAt: status === 'SUBMITTED' ? new Date() : x.submittedAt,
      approvedAt: status === 'APPROVED' || status === 'ACCEPTED' ? new Date() : x.approvedAt,
      approvalEvidence: opts.evidence ?? x.approvalEvidence,
      approvalConfirmedBy: status === 'APPROVED' || status === 'ACCEPTED' ? ctx.userId : x.approvalConfirmedBy,
      revisionRounds: status === 'CHANGES_REQUESTED' ? x.revisionRounds + 1 : x.revisionRounds,
      updatedAt: new Date(),
    })
    .where(eq(dealDeliverables.id, id))
    .returning();
  if (status === 'APPROVED') await emit(ctx.db, ctx.orgId, 'deal.approval_received', { dealId: x.dealId, deliverableId: id });
  await audit(ctx, 'deliverable.status', { type: 'deliverable', id }, { status: x.status }, { status, evidence: opts.evidence });
  return after!;
}

export async function getDeal(ctx: Ctx, id: string) {
  const [d] = await ctx.db.select().from(deals).where(and(eq(deals.id, id), eq(deals.orgId, ctx.orgId), isNull(deals.deletedAt)));
  if (!d) throw notFound('Deal');
  const deliverables = await ctx.db.select().from(dealDeliverables).where(eq(dealDeliverables.dealId, id)).orderBy(asc(dealDeliverables.dueAt));
  const inv = await ctx.db.select().from(invoices).where(eq(invoices.dealId, id)).orderBy(desc(invoices.createdAt));
  const pays = inv.length ? rowsOf<any>(await ctx.db.execute(sql`select * from payments where invoice_id in (${sql.join(inv.map((i) => sql`${i.id}::uuid`), sql`, `)}) order by received_at`)) : [];
  const threads = await ctx.db.select({ id: conversationThreads.id, subject: conversationThreads.subject, state: conversationThreads.state }).from(conversationThreads).where(eq(conversationThreads.dealId, id));
  const exp = await ctx.db.select().from(expenses).where(eq(expenses.dealId, id));
  const invoiced = inv.filter((i) => i.status !== 'VOID' && i.status !== 'DRAFT').reduce((s, i) => s + i.amountMinor, 0);
  const received = inv.reduce((s, i) => s + i.paidTotalMinor, 0);
  return { ...d, deliverables, invoices: inv.map((i) => ({ ...i, payments: pays.filter((p: any) => p.invoice_id === i.id) })), threads, expenses: exp, summary: { currency: d.currency, contractedMinor: d.contractedValueMinor, invoicedMinor: invoiced, receivedMinor: received, outstandingMinor: Math.max(0, invoiced - received) } };
}

export async function pipeline(ctx: Ctx) {
  const rows = rowsOf<any>(
    await ctx.db.execute(sql`
      select d.id, d.title, d.stage, d.currency, d.contracted_value_minor::float8 as "valueMinor", d.next_due_at as "nextDueAt", d.priority, d.stage_changed_at as "stageChangedAt", eo.name as "brand"
      from deals d left join external_organizations eo on eo.id = d.external_org_id
      where d.org_id = ${ctx.orgId} and d.deleted_at is null order by d.next_due_at asc nulls last, d.created_at desc limit 1000`),
  );
  const columns = DEAL_STAGE.map((stage) => {
    const items = rows.filter((r) => r.stage === stage);
    const totals: Record<string, number> = {}; // never summed across currencies
    for (const i of items) if (i.valueMinor) totals[i.currency] = (totals[i.currency] ?? 0) + i.valueMinor;
    return { stage, count: items.length, totals, items };
  });
  return { columns };
}

// ---------------------------------------------------------------- invoicing

async function nextInvoiceNo(tx: Executor, orgId: string, year: number) {
  const r = rowsOf<{ n: number }>(await tx.execute(sql`select coalesce(max(substring(invoice_no from '^INV-${sql.raw(String(year))}-(\\d+)$')::int), 0)::int as n from invoices where org_id = ${orgId}`));
  return `INV-${year}-${String((r[0]?.n ?? 0) + 1).padStart(4, '0')}`;
}

export async function createInvoice(ctx: Ctx, input: { dealId?: string | null; invoiceNo?: string; amountMinor: number; currency?: string; issuedAt?: Date | string | null; dueAt?: Date | string | null; termsDays?: number; notes?: string | null; draft?: boolean }) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw badRequest('Amount must be a positive whole number of minor units (e.g. cents)');
  return ctx.db.transaction(async (tx) => {
    let currency = input.currency;
    let termsDays = input.termsDays;
    if (input.dealId) {
      const [d] = await tx.select().from(deals).where(and(eq(deals.id, input.dealId), eq(deals.orgId, ctx.orgId)));
      if (!d) throw notFound('Deal');
      currency ??= d.currency;
      termsDays ??= d.paymentTermsDays ?? undefined;
    }
    currency = (currency ?? 'USD').toUpperCase();
    const issuedAt = input.draft ? null : new Date(input.issuedAt ?? Date.now());
    const dueAt = input.dueAt ? new Date(input.dueAt) : issuedAt && termsDays ? new Date(issuedAt.getTime() + termsDays * 86400_000) : null;
    const invoiceNo = input.invoiceNo?.trim() || (await nextInvoiceNo(tx, ctx.orgId, (issuedAt ?? new Date()).getUTCFullYear()));
    const [dup] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.invoiceNo, invoiceNo)));
    if (dup) throw conflict(`Invoice number ${invoiceNo} already exists.`, undefined, 'DUPLICATE_INVOICE_NO');
    const [i] = await tx.insert(invoices).values({ orgId: ctx.orgId, dealId: input.dealId ?? null, invoiceNo, issuedAt, dueAt, currency, amountMinor: input.amountMinor, status: input.draft ? 'DRAFT' : 'ISSUED', notes: input.notes ?? null }).returning();
    await audit({ ...ctx, db: tx }, 'invoice.create', { type: 'invoice', id: i!.id }, undefined, { invoiceNo, amountMinor: input.amountMinor, currency });
    return i!;
  });
}

export async function issueInvoice(ctx: Ctx, id: string, dueAt?: Date | null) {
  const [i] = await ctx.db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)));
  if (!i) throw notFound('Invoice');
  if (i.status !== 'DRAFT') throw conflict('Only draft invoices can be issued.');
  const [after] = await ctx.db.update(invoices).set({ status: 'ISSUED', issuedAt: new Date(), dueAt: dueAt ?? i.dueAt, updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
  return after!;
}

export async function voidInvoice(ctx: Ctx, id: string) {
  const [i] = await ctx.db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)));
  if (!i) throw notFound('Invoice');
  if (i.paidTotalMinor > 0) throw conflict('An invoice with payments cannot be voided.', undefined, 'HAS_PAYMENTS');
  const [after] = await ctx.db.update(invoices).set({ status: 'VOID', updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
  await audit(ctx, 'invoice.void', { type: 'invoice', id });
  return after!;
}

/**
 * Payment recording is transactional and currency-safe: the row lock stops two concurrent payments both
 * "completing" the invoice, amounts are integer minor units, a payment must be in the invoice currency, and overpayment is refused.
 */
export async function recordPayment(ctx: Ctx, invoiceId: string, input: { amountMinor: number; currency?: string; receivedAt?: Date | string; method?: (typeof payments.$inferInsert)['method']; reference?: string | null; notes?: string | null; verified?: boolean; allowOverpay?: boolean }) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw badRequest('Payment amount must be a positive whole number of minor units');
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from invoices where id = ${invoiceId} and org_id = ${ctx.orgId} for update`);
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, ctx.orgId)));
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'VOID' || inv.status === 'DRAFT') throw conflict(`Cannot record a payment on a ${inv.status.toLowerCase()} invoice.`);
    const currency = (input.currency ?? inv.currency).toUpperCase();
    if (currency !== inv.currency) throw badRequest(`Payment currency ${currency} does not match invoice currency ${inv.currency}. Record the amount in ${inv.currency} (with the FX rate in notes).`, undefined, 'CURRENCY_MISMATCH');
    const newPaid = inv.paidTotalMinor + input.amountMinor;
    if (newPaid > inv.amountMinor && !input.allowOverpay) throw conflict('This payment would exceed the invoice amount.', { dueMinor: inv.amountMinor - inv.paidTotalMinor }, 'OVERPAYMENT');
    const [p] = await tx.insert(payments).values({ orgId: ctx.orgId, invoiceId, amountMinor: input.amountMinor, currency, receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(), method: input.method ?? 'OTHER', reference: input.reference ?? null, notes: input.notes ?? null, verified: input.verified ?? false, provenance: 'USER_ENTERED' }).returning();
    const status = deriveInvoiceStatus({ status: inv.status, amountMinor: inv.amountMinor, paidMinor: newPaid, dueAt: inv.dueAt });
    const [after] = await tx.update(invoices).set({ paidTotalMinor: newPaid, status, updatedAt: new Date() }).where(eq(invoices.id, invoiceId)).returning();
    if (status === 'PAID') await emit(tx, ctx.orgId, 'invoice.paid', { invoiceId, dealId: inv.dealId });
    await audit({ ...ctx, db: tx }, 'payment.record', { type: 'invoice', id: invoiceId }, undefined, { amountMinor: input.amountMinor, currency });
    return { payment: p!, invoice: after! };
  });
}

/** Worker job: flips overdue invoices and emits invoice.overdue once per transition. */
export async function refreshInvoiceStatuses(db: Ctx['db'], orgId: string, now = new Date()) {
  const rows = rowsOf<{ id: string; dealId: string | null }>(
    await db.execute(sql`update invoices set status = 'OVERDUE', updated_at = now() where org_id = ${orgId} and status in ('ISSUED','PARTIALLY_PAID') and due_at is not null and due_at < ${now.toISOString()}::timestamptz and paid_total_minor < amount_minor returning id, deal_id as "dealId"`),
  );
  for (const r of rows) await emit(db, orgId, 'invoice.overdue', { invoiceId: r.id, dealId: r.dealId });
  return { overdue: rows.length };
}

export async function setFxRate(ctx: Ctx, input: { base: string; quote: string; rate: number; rateDate: Date | string; source?: string }) {
  if (!(input.rate > 0)) throw badRequest('Rate must be positive');
  const [r] = await ctx.db
    .insert(fxRates)
    .values({ orgId: ctx.orgId, baseCurrency: input.base.toUpperCase(), quoteCurrency: input.quote.toUpperCase(), rate: String(input.rate), rateDate: new Date(input.rateDate), source: input.source ?? 'manual' })
    .onConflictDoUpdate({ target: [fxRates.orgId, fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.rateDate], set: { rate: String(input.rate), source: input.source ?? 'manual' } })
    .returning();
  return r!;
}

/** Finance totals stay per currency. A converted grand total is offered only when a dated FX rate exists for every currency used. */
export async function financeSummary(ctx: Ctx, range: { from?: Date; to?: Date } = {}) {
  const from = range.from ?? new Date(0);
  const to = range.to ?? new Date(Date.now() + 86400_000);
  const base = rowsOf<{ baseCurrency: string }>(await ctx.db.execute(sql`select base_currency as "baseCurrency" from organizations where id = ${ctx.orgId}`))[0]?.baseCurrency ?? 'CAD';
  const q = async (query: ReturnType<typeof sql>) => rowsOf<{ currency: string; n: number }>(await ctx.db.execute(query));
  const received = await q(sql`select p.currency, sum(p.amount_minor)::float8 as n from payments p where p.org_id = ${ctx.orgId} and p.received_at >= ${from.toISOString()}::timestamptz and p.received_at < ${to.toISOString()}::timestamptz group by 1`);
  const outstanding = await q(sql`select currency, sum(amount_minor - paid_total_minor)::float8 as n from invoices where org_id = ${ctx.orgId} and status in ('ISSUED','PARTIALLY_PAID','OVERDUE') group by 1`);
  const overdue = await q(sql`select currency, sum(amount_minor - paid_total_minor)::float8 as n from invoices where org_id = ${ctx.orgId} and status = 'OVERDUE' group by 1`);
  const spent = await q(sql`select currency, sum(amount_minor)::float8 as n from expenses where org_id = ${ctx.orgId} and incurred_at >= ${from.toISOString()}::timestamptz and incurred_at < ${to.toISOString()}::timestamptz group by 1`);
  const rates = await ctx.db.select().from(fxRates).where(eq(fxRates.orgId, ctx.orgId)).orderBy(desc(fxRates.rateDate));
  const currencies = new Set([...received, ...outstanding, ...overdue, ...spent].map((r) => r.currency));
  const rateFor = (cur: string) => (cur === base ? { rate: 1, date: null as Date | null } : (() => { const r = rates.find((x) => x.baseCurrency === cur && x.quoteCurrency === base); return r ? { rate: Number(r.rate), date: r.rateDate } : undefined; })());
  const missing = [...currencies].filter((c) => !rateFor(c));
  const toMap = (rows: { currency: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.currency, r.n]));
  const conv = (rows: { currency: string; n: number }[]) => (missing.length ? null : Math.round(rows.reduce((s, r) => s + r.n * rateFor(r.currency)!.rate, 0)));
  return {
    baseCurrency: base,
    perCurrency: { received: toMap(received), outstanding: toMap(outstanding), overdue: toMap(overdue), expenses: toMap(spent) },
    converted: missing.length ? null : { receivedMinor: conv(received), outstandingMinor: conv(outstanding), overdueMinor: conv(overdue), expensesMinor: conv(spent), rates: [...currencies].map((c) => ({ currency: c, ...rateFor(c) })) },
    missingFxRates: missing,
  };
}

export async function listInvoices(ctx: Ctx, q: { status?: string; dealId?: string; limit?: number } = {}) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select i.id, i.invoice_no as "invoiceNo", i.status, i.currency, i.amount_minor::float8 as "amountMinor", i.issued_at as "issuedAt", i.due_at as "dueAt", i.deal_id as "dealId", d.title as "dealTitle",
             coalesce((select sum(p.amount_minor) from payments p where p.invoice_id = i.id), 0)::float8 as "paidMinor"
      from invoices i left join deals d on d.id = i.deal_id
      where i.org_id = ${ctx.orgId} ${q.status ? sql`and i.status = ${q.status}::invoice_status` : sql``} ${q.dealId ? sql`and i.deal_id = ${q.dealId}` : sql``}
      order by i.issued_at desc nulls last, i.created_at desc limit ${Math.min(q.limit ?? 100, 500)}`),
  );
}

export async function getInvoice(ctx: Ctx, id: string) {
  const [i] = await ctx.db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)));
  if (!i) throw notFound('Invoice');
  const pays = await ctx.db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.receivedAt));
  return { ...i, payments: pays };
}

export async function listDeals(ctx: Ctx, q: { stage?: string; q?: string; limit?: number } = {}) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select d.id, d.title, d.stage, d.currency, d.contracted_value_minor::float8 as "valueMinor", d.next_due_at as "nextDueAt", d.priority, eo.name as brand
      from deals d left join external_organizations eo on eo.id = d.external_org_id
      where d.org_id = ${ctx.orgId} and d.deleted_at is null ${q.stage ? sql`and d.stage = ${q.stage}::deal_stage` : sql``} ${q.q ? sql`and d.title ilike ${'%' + q.q + '%'}` : sql``}
      order by d.created_at desc limit ${Math.min(q.limit ?? 100, 500)}`),
  );
}
