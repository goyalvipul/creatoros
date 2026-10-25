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
  invoiceLines,
  invoices,
  isNull,
  messages,
  opportunities,
  payments,
  sql,
  type Executor,
} from '@creatoros/db';
import {
  CLOSED_DEAL_STAGES,
  DEAL_STAGE,
  classifyMessage,
  deriveInvoiceStatus,
  INVOICE_STATUS_CHOICES,
  type DealStage,
} from '@creatoros/domain';
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
  const checksum = sha256Hex(
    [
      input.source,
      input.principal ?? '',
      input.providerMsgId ?? '',
      receivedAt.toISOString(),
      input.fromEmail ?? '',
      input.subject ?? '',
      body,
    ].join('\u0000'),
  );
  return ctx.db.transaction(async (tx) => {
    // thread
    let thread: typeof conversationThreads.$inferSelect | undefined;
    if (input.providerThreadId) {
      [thread] = await tx
        .select()
        .from(conversationThreads)
        .where(
          and(
            eq(conversationThreads.orgId, ctx.orgId),
            eq(conversationThreads.source, input.source),
            eq(conversationThreads.providerThreadId, input.providerThreadId),
            input.principal
              ? eq(conversationThreads.principal, input.principal)
              : isNull(conversationThreads.principal),
          ),
        );
    }
    if (!thread) {
      [thread] = await tx
        .insert(conversationThreads)
        .values({
          orgId: ctx.orgId,
          source: input.source,
          principal: input.principal ?? null,
          providerThreadId: input.providerThreadId ?? null,
          subject: input.subject ?? null,
          providerConnectionId: input.providerConnectionId ?? null,
          externalLink: input.externalLink ?? null,
          state: input.direction === 'INBOUND' ? 'NEED_REPLY' : 'WAITING_FOR_BRAND',
        })
        .onConflictDoNothing()
        .returning();
      if (!thread) {
        [thread] = await tx
          .select()
          .from(conversationThreads)
          .where(
            and(
              eq(conversationThreads.orgId, ctx.orgId),
              eq(conversationThreads.source, input.source),
              eq(conversationThreads.providerThreadId, input.providerThreadId!),
            ),
          );
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
    const newestBefore = Math.max(
      thread!.lastInboundAt?.getTime() ?? 0,
      thread!.lastOutboundAt?.getTime() ?? 0,
    );
    const inbound = input.direction === 'INBOUND';
    const patch: Partial<typeof conversationThreads.$inferInsert> = {
      lastInboundAt:
        inbound && (!thread!.lastInboundAt || receivedAt > thread!.lastInboundAt)
          ? receivedAt
          : thread!.lastInboundAt,
      lastOutboundAt:
        !inbound && (!thread!.lastOutboundAt || receivedAt > thread!.lastOutboundAt)
          ? receivedAt
          : thread!.lastOutboundAt,
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
      classification = classifyMessage({
        subject: input.subject,
        body,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
      });
      await tx
        .insert(inboundClassifications)
        .values({
          orgId: ctx.orgId,
          messageId: msg.id,
          category: classification.category,
          extracted: classification.extracted as Record<string, unknown>,
          signals: classification.signals,
          confidence: classification.confidence,
        })
        .onConflictDoNothing();
      if (classification.category === 'COLLABORATION')
        await emit(tx, ctx.orgId, 'deal.inquiry.detected', {
          threadId: thread!.id,
          messageId: msg.id,
          confidence: classification.confidence,
        });
      if (thread!.opportunityId || thread!.dealId)
        await emit(tx, ctx.orgId, 'deal.reply_required', { threadId: thread!.id, dealId: thread!.dealId });
    }
    return { threadId: thread!.id, messageId: msg.id, duplicate: false, classification };
  });
}

/** One definition of each mailbox tab, shared by the list and the counts so they can never disagree. */
function folderSql(folder: 'inbox' | 'starred' | 'followup' | 'pipeline' | 'archived') {
  switch (folder) {
    case 'inbox':
      return sql`(not t.archived_local and t.triage_state not in ('DISMISSED','CONFIRMED'))`;
    case 'starred':
      return sql`(t.starred and not t.archived_local and t.triage_state <> 'DISMISSED')`;
    case 'followup':
      return sql`(t.follow_up_at is not null and not t.archived_local and t.triage_state <> 'DISMISSED')`;
    case 'pipeline':
      return sql`(t.triage_state = 'CONFIRMED' and not t.archived_local)`;
    case 'archived':
      return sql`(t.archived_local or t.triage_state = 'DISMISSED')`;
  }
}

/** Tab counts for the email inbox, optionally for one mailbox. */
export async function mailCounts(ctx: Ctx, q: { connectionId?: string } = {}) {
  const conn = q.connectionId ? sql`and t.provider_connection_id = ${q.connectionId}::uuid` : sql``;
  const [r] = rowsOf<Record<string, number>>(
    await ctx.db.execute(sql`
      select count(*) filter (where ${folderSql('inbox')})::int as inbox,
             count(*) filter (where ${folderSql('inbox')} and t.state = 'NEED_REPLY')::int as "needReply",
             count(*) filter (where ${folderSql('starred')})::int as starred,
             count(*) filter (where ${folderSql('followup')})::int as followup,
             count(*) filter (where ${folderSql('pipeline')})::int as pipeline,
             count(*) filter (where ${folderSql('archived')})::int as archived
      from conversation_threads t
      where t.org_id = ${ctx.orgId} and t.merged_into_id is null and t.source not in ('INSTAGRAM','FACEBOOK','TIKTOK','YOUTUBE') ${conn}`),
  );
  return r ?? { inbox: 0, needReply: 0, starred: 0, followup: 0, pipeline: 0, archived: 0 };
}

export async function listThreads(
  ctx: Ctx,
  q: {
    state?: string;
    triage?: string;
    category?: string;
    /** deal = already tied to a deal or an opportunity (the Home “need a reply” set). */
    linked?: 'deal';
    /** none = no opportunity yet (the Home “possible collaborations” set). */
    opportunity?: 'none';
    q?: string;
    dealId?: string;
    limit?: number;
    /** 'mail' hides Instagram/Facebook/TikTok/YouTube conversations (they live in Socials). */
    scope?: 'mail' | 'all';
    connectionId?: string;
    /** 'manual' = pasted/manual threads without a mailbox */
    folder?: 'inbox' | 'starred' | 'followup' | 'pipeline' | 'archived';
  } = {},
) {
  const where = [sql`t.org_id = ${ctx.orgId}`, sql`t.merged_into_id is null`];
  if (q.scope === 'mail') where.push(sql`t.source not in ('INSTAGRAM','FACEBOOK','TIKTOK','YOUTUBE')`);
  if (q.connectionId) where.push(sql`t.provider_connection_id = ${q.connectionId}::uuid`);
  if (q.folder) where.push(folderSql(q.folder));
  if (q.state) where.push(sql`t.state = ${q.state}::actionable_state`);
  if (q.triage) where.push(sql`t.triage_state = ${q.triage}::triage_state`);
  if (q.dealId) where.push(sql`t.deal_id = ${q.dealId}`);
  if (q.category)
    where.push(
      sql`exists (select 1 from messages m join inbound_classifications c on c.message_id = m.id where m.thread_id = t.id and c.category = ${q.category})`,
    );
  if (q.linked === 'deal') where.push(sql`(t.deal_id is not null or t.opportunity_id is not null)`);
  if (q.opportunity === 'none') where.push(sql`t.opportunity_id is null`);
  if (q.q?.trim())
    where.push(
      sql`(t.subject ilike ${'%' + esc(q.q.trim()) + '%'} or exists (select 1 from messages m where m.thread_id = t.id and (m.from_email ilike ${'%' + esc(q.q.trim()) + '%'} or m.body_preview ilike ${'%' + esc(q.q.trim()) + '%'})))`,
    );
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select t.id, t.subject, t.source, t.state, t.triage_state as "triageState", t.last_inbound_at as "lastInboundAt", t.last_outbound_at as "lastOutboundAt",
             t.snooze_until as "snoozeUntil", t.opportunity_id as "opportunityId", t.deal_id as "dealId", t.external_link as "externalLink",
             t.starred, t.archived_local as "archivedLocal", t.follow_up_at as "followUpAt", t.provider_connection_id as "connectionId", t.principal,
             (select count(*)::int from invoice_suggestions s where s.thread_id = t.id and s.status = 'SUGGESTED') as "invoiceHints",
             (select m.from_name from messages m where m.thread_id = t.id and m.direction = 'INBOUND' order by m.received_at desc limit 1) as "fromName",
             (select m.from_email from messages m where m.thread_id = t.id and m.direction = 'INBOUND' order by m.received_at desc limit 1) as "fromEmail",
             (select m.body_preview from messages m where m.thread_id = t.id order by m.received_at desc limit 1) as preview,
             (select c.category from messages m join inbound_classifications c on c.message_id = m.id where m.thread_id = t.id order by c.confidence desc limit 1) as category,
             (select max(c.confidence) from messages m join inbound_classifications c on c.message_id = m.id where m.thread_id = t.id) as confidence
      from conversation_threads t where ${sql.join(where, sql` and `)}
      order by greatest(coalesce(t.last_inbound_at, '-infinity'::timestamptz), coalesce(t.last_outbound_at, '-infinity'::timestamptz)) desc, t.created_at desc limit ${Math.min(q.limit ?? 100, 500)}`),
  );
}

export async function getThread(ctx: Ctx, id: string, withBodies = true) {
  const [t] = await ctx.db
    .select()
    .from(conversationThreads)
    .where(and(eq(conversationThreads.id, id), eq(conversationThreads.orgId, ctx.orgId)));
  if (!t) throw notFound('Thread');
  const msgs = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.threadId, id))
    .orderBy(asc(messages.receivedAt));
  const cls = rowsOf<any>(
    await ctx.db.execute(
      sql`select c.* from inbound_classifications c join messages m on m.id = c.message_id where m.thread_id = ${id}`,
    ),
  );
  return {
    ...t,
    messages: msgs.map(({ bodyEnc, ...m }) => ({
      ...m,
      body: withBodies && bodyEnc ? safeDecrypt(bodyEnc, ctx) : null,
      classification: cls.find((c) => c.message_id === m.id) ?? null,
    })),
  };
}

function safeDecrypt(enc: string, ctx: Ctx) {
  try {
    return decrypt(enc, ctx.env.encryptionKey);
  } catch {
    return null;
  }
}

export async function setThreadState(
  ctx: Ctx,
  id: string,
  state: 'NEED_REPLY' | 'WAITING_FOR_BRAND' | 'WAITING_FOR_USER' | 'DONE',
  snoozeUntil?: Date | null,
) {
  const [t] = await ctx.db
    .update(conversationThreads)
    .set({
      state,
      snoozeUntil: snoozeUntil ?? null,
      lastAnsweredAt: state === 'DONE' ? new Date() : sql`${conversationThreads.lastAnsweredAt}`,
      updatedAt: new Date(),
    })
    .where(and(eq(conversationThreads.id, id), eq(conversationThreads.orgId, ctx.orgId)))
    .returning();
  if (!t) throw notFound('Thread');
  await audit(ctx, 'thread.state', { type: 'thread', id }, undefined, { state, snoozeUntil });
  return t;
}

async function upsertExternalOrg(tx: Executor, ctx: Ctx, name: string | undefined | null) {
  const n = name?.trim();
  if (!n) return null;
  const [existing] = await tx
    .select()
    .from(externalOrganizations)
    .where(
      and(
        eq(externalOrganizations.orgId, ctx.orgId),
        sql`lower(${externalOrganizations.name}) = lower(${n})`,
        isNull(externalOrganizations.deletedAt),
      ),
    );
  if (existing) return existing;
  const [o] = await tx
    .insert(externalOrganizations)
    .values({ orgId: ctx.orgId, name: n })
    .onConflictDoNothing()
    .returning();
  if (o) return o;
  const [again] = await tx
    .select()
    .from(externalOrganizations)
    .where(
      and(
        eq(externalOrganizations.orgId, ctx.orgId),
        sql`lower(${externalOrganizations.name}) = lower(${n})`,
      ),
    );
  return again!;
}

async function upsertContact(
  tx: Executor,
  ctx: Ctx,
  email: string | null | undefined,
  name: string | null | undefined,
  externalOrgId: string | null,
) {
  const e = email?.trim().toLowerCase();
  if (!e) return null;
  const [existing] = await tx
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.orgId, ctx.orgId),
        sql`${contacts.emails} @> ARRAY[${e}]::text[]`,
        isNull(contacts.deletedAt),
      ),
    );
  if (existing) return existing;
  const [c] = await tx
    .insert(contacts)
    .values({ orgId: ctx.orgId, name: name?.trim() || e, emails: [e], externalOrgId })
    .returning();
  return c!;
}

/**
 * Owner reviews a suggested collaboration. CONFIRMED creates one opportunity per thread (idempotent); DISMISSED hides it from the queue
 * without deleting anything; MERGED folds a duplicate thread into another.
 */
export async function triageThread(
  ctx: Ctx,
  threadId: string,
  outcome: 'CONFIRMED' | 'DISMISSED' | 'MERGED',
  opts: { mergeIntoId?: string; title?: string } = {},
) {
  return ctx.db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(conversationThreads)
      .where(and(eq(conversationThreads.id, threadId), eq(conversationThreads.orgId, ctx.orgId)));
    if (!t) throw notFound('Thread');
    const cls = rowsOf<any>(
      await tx.execute(
        sql`select c.* from inbound_classifications c join messages m on m.id = c.message_id where m.thread_id = ${threadId} order by c.confidence desc limit 1`,
      ),
    )[0];
    if (outcome === 'DISMISSED') {
      await tx
        .update(conversationThreads)
        .set({ triageState: 'DISMISSED', updatedAt: new Date() })
        .where(eq(conversationThreads.id, threadId));
      if (cls)
        await tx.execute(
          sql`update inbound_classifications set review_outcome = 'REJECTED', reviewed_by = ${ctx.userId}, reviewed_at = now() where id = ${cls.id}`,
        );
      await audit({ ...ctx, db: tx }, 'thread.triage.dismiss', { type: 'thread', id: threadId });
      return { threadId, triageState: 'DISMISSED' as const };
    }
    if (outcome === 'MERGED') {
      if (!opts.mergeIntoId || opts.mergeIntoId === threadId) throw badRequest('mergeIntoId is required');
      const [target] = await tx
        .select()
        .from(conversationThreads)
        .where(and(eq(conversationThreads.id, opts.mergeIntoId), eq(conversationThreads.orgId, ctx.orgId)));
      if (!target) throw notFound('Target thread');
      await tx
        .update(conversationThreads)
        .set({ triageState: 'MERGED', mergedIntoId: target.id, updatedAt: new Date() })
        .where(eq(conversationThreads.id, threadId));
      await audit({ ...ctx, db: tx }, 'thread.triage.merge', { type: 'thread', id: threadId }, undefined, {
        into: target.id,
      });
      return { threadId, triageState: 'MERGED' as const };
    }
    const existing = t.opportunityId
      ? (await tx.select().from(opportunities).where(eq(opportunities.id, t.opportunityId)))[0]
      : undefined;
    if (existing)
      return { threadId, triageState: 'CONFIRMED' as const, opportunity: existing, alreadyConfirmed: true };
    const lastIn = rowsOf<any>(
      await tx.execute(
        sql`select from_email as "fromEmail", from_name as "fromName" from messages where thread_id = ${threadId} and direction = 'INBOUND' order by received_at desc limit 1`,
      ),
    )[0];
    const x = (cls?.extracted ?? {}) as Record<string, any>;
    const org = await upsertExternalOrg(tx, ctx, x.brandGuess ?? lastIn?.fromName);
    const contact = await upsertContact(tx, ctx, lastIn?.fromEmail, lastIn?.fromName, org?.id ?? null);
    const [opp] = await tx
      .insert(opportunities)
      .values({
        orgId: ctx.orgId,
        sourceThreadId: threadId,
        externalOrgId: org?.id ?? null,
        contactId: contact?.id ?? null,
        title: opts.title?.trim() || t.subject || `Opportunity from ${lastIn?.fromEmail ?? 'inbound'}`,
        offerType: (x.compensation as any) ?? 'UNKNOWN',
        stage: 'TRIAGE',
        predictedValueMinor: x.amountMinor ?? null,
        currency: x.currency ?? 'USD',
        createdBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning();
    const opportunity =
      opp ?? (await tx.select().from(opportunities).where(eq(opportunities.sourceThreadId, threadId)))[0]!;
    await tx
      .update(conversationThreads)
      .set({
        triageState: 'CONFIRMED',
        opportunityId: opportunity.id,
        externalOrgId: org?.id ?? null,
        contactId: contact?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(conversationThreads.id, threadId));
    if (cls)
      await tx.execute(
        sql`update inbound_classifications set review_outcome = 'ACCEPTED', reviewed_by = ${ctx.userId}, reviewed_at = now() where id = ${cls.id}`,
      );
    await audit({ ...ctx, db: tx }, 'thread.triage.confirm', { type: 'thread', id: threadId }, undefined, {
      opportunityId: opportunity.id,
    });
    return { threadId, triageState: 'CONFIRMED' as const, opportunity, alreadyConfirmed: false };
  });
}

/** Manual collaboration intake: the owner types it in, so it is a confirmed opportunity immediately. */
export async function manualIntake(
  ctx: Ctx,
  input: {
    brand: string;
    contactName?: string;
    contactEmail?: string;
    subject: string;
    notes?: string;
    offerType?: (typeof opportunities.$inferInsert)['offerType'];
    valueMinor?: number | null;
    currency?: string;
    source?: NonNullable<(typeof messages.$inferInsert)['source']>;
  },
) {
  if (!input.brand?.trim() || !input.subject?.trim()) throw badRequest('Brand and subject are required');
  const res = await ingestMessage(ctx, {
    source: input.source ?? 'MANUAL',
    direction: 'INBOUND',
    receivedAt: new Date(),
    fromEmail: input.contactEmail ?? null,
    fromName: input.contactName ?? input.brand,
    subject: input.subject,
    body: input.notes ?? input.subject,
    provenance: 'USER_ENTERED',
  });
  return ctx.db.transaction(async (tx) => {
    const org = await upsertExternalOrg(tx, ctx, input.brand);
    const contact = await upsertContact(tx, ctx, input.contactEmail, input.contactName, org?.id ?? null);
    const [opp] = await tx
      .insert(opportunities)
      .values({
        orgId: ctx.orgId,
        sourceThreadId: res.threadId,
        externalOrgId: org?.id ?? null,
        contactId: contact?.id ?? null,
        title: input.subject.trim(),
        offerType: input.offerType ?? 'UNKNOWN',
        stage: 'TRIAGE',
        predictedValueMinor: input.valueMinor ?? null,
        currency: input.currency ?? 'USD',
        createdBy: ctx.userId,
        notes: input.notes ?? null,
      })
      .returning();
    await tx
      .update(conversationThreads)
      .set({
        triageState: 'CONFIRMED',
        opportunityId: opp!.id,
        externalOrgId: org?.id ?? null,
        contactId: contact?.id ?? null,
      })
      .where(eq(conversationThreads.id, res.threadId));
    await audit({ ...ctx, db: tx }, 'opportunity.create', { type: 'opportunity', id: opp!.id });
    return { opportunity: opp!, threadId: res.threadId };
  });
}

// -------------------------------------------------------------------- deals

export async function convertOpportunityToDeal(
  ctx: Ctx,
  opportunityId: string,
  input: {
    stage?: DealStage;
    title?: string;
    compensationType?: (typeof deals.$inferInsert)['compensationType'];
    contractedValueMinor?: number | null;
    currency?: string;
    paymentTermsDays?: number | null;
  } = {},
) {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from opportunities where id = ${opportunityId} for update`);
    const [o] = await tx
      .select()
      .from(opportunities)
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.orgId, ctx.orgId),
          isNull(opportunities.deletedAt),
        ),
      );
    if (!o) throw notFound('Opportunity');
    const [existing] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.opportunityId, opportunityId), isNull(deals.deletedAt)));
    if (existing) return { deal: existing, alreadyConverted: true };
    const stage = input.stage ?? 'QUALIFIED';
    const [d] = await tx
      .insert(deals)
      .values({
        orgId: ctx.orgId,
        opportunityId,
        externalOrgId: o.externalOrgId,
        contactId: o.contactId,
        brandId: o.brandId,
        channelId: o.channelId,
        title: input.title?.trim() || o.title,
        stage,
        compensationType: input.compensationType ?? o.offerType,
        contractedValueMinor: input.contractedValueMinor ?? o.predictedValueMinor,
        currency: input.currency ?? o.currency,
        paymentTermsDays: input.paymentTermsDays ?? null,
        ownerUserId: ctx.userId,
      })
      .returning();
    await tx
      .update(opportunities)
      .set({ stage, updatedAt: new Date() })
      .where(eq(opportunities.id, opportunityId));
    if (o.sourceThreadId)
      await tx
        .update(conversationThreads)
        .set({ dealId: d!.id })
        .where(eq(conversationThreads.id, o.sourceThreadId));
    await audit({ ...ctx, db: tx }, 'deal.create', { type: 'deal', id: d!.id }, undefined, { opportunityId });
    return { deal: d!, alreadyConverted: false };
  });
}

export async function createDeal(ctx: Ctx, input: Partial<typeof deals.$inferInsert> & { title: string }) {
  if (!input.title?.trim()) throw badRequest('Title is required');
  const [d] = await ctx.db
    .insert(deals)
    .values({
      ...input,
      id: undefined,
      orgId: ctx.orgId,
      title: input.title.trim(),
      ownerUserId: input.ownerUserId ?? ctx.userId,
      deletedAt: null,
      closedAt: null,
    })
    .returning();
  await audit(ctx, 'deal.create', { type: 'deal', id: d!.id });
  return d!;
}

export async function updateDeal(ctx: Ctx, id: string, patch: Partial<typeof deals.$inferInsert>) {
  const { id: _i, orgId: _o, stage: _s, closedAt: _c, ...safe } = patch as any;
  const [before] = await ctx.db
    .select()
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.orgId, ctx.orgId), isNull(deals.deletedAt)));
  if (!before) throw notFound('Deal');
  const [after] = await ctx.db
    .update(deals)
    .set({ ...safe, updatedAt: new Date() })
    .where(eq(deals.id, id))
    .returning();
  await audit(ctx, 'deal.update', { type: 'deal', id }, before, after);
  return after!;
}

export async function changeDealStage(
  ctx: Ctx,
  id: string,
  to: DealStage,
  opts: { reason?: string; force?: boolean } = {},
) {
  if (!DEAL_STAGE.includes(to)) throw badRequest(`Unknown stage ${to}`);
  return ctx.db.transaction(async (tx) => {
    const [d] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.id, id), eq(deals.orgId, ctx.orgId), isNull(deals.deletedAt)));
    if (!d) throw notFound('Deal');
    if (d.stage === to) return d;
    if (to === 'PAID_CLOSED' && !opts.force) {
      const [o] = rowsOf<{ due: number }>(
        await tx.execute(
          sql`select coalesce(sum(amount_minor - paid_total_minor),0)::float8 as due from invoices where deal_id = ${id} and status not in ('VOID','DRAFT')`,
        ),
      );
      if ((o?.due ?? 0) > 0)
        throw conflict('There are unpaid invoices on this deal.', { dueMinor: o!.due }, 'UNPAID_INVOICES');
    }
    const closed = CLOSED_DEAL_STAGES.includes(to);
    const [after] = await tx
      .update(deals)
      .set({
        stage: to,
        stageChangedAt: new Date(),
        closedAt: closed ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(deals.id, id))
      .returning();
    if (d.opportunityId)
      await tx
        .update(opportunities)
        .set({ stage: to, updatedAt: new Date() })
        .where(eq(opportunities.id, d.opportunityId));
    if (to === 'APPROVED') await emit(tx, ctx.orgId, 'deal.approval_received', { dealId: id });
    await audit(
      { ...ctx, db: tx },
      'deal.stage',
      { type: 'deal', id },
      { stage: d.stage },
      { stage: to, reason: opts.reason },
    );
    return after!;
  });
}

export async function addDeliverable(
  ctx: Ctx,
  dealId: string,
  input: Partial<typeof dealDeliverables.$inferInsert> & { title: string },
) {
  const [d] = await ctx.db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.orgId, ctx.orgId)));
  if (!d) throw notFound('Deal');
  const [x] = await ctx.db
    .insert(dealDeliverables)
    .values({
      ...input,
      id: undefined,
      orgId: ctx.orgId,
      dealId,
      status: 'PLANNED',
      approvedAt: null,
      submittedAt: null,
      approvalEvidence: null,
      approvalConfirmedBy: null,
    })
    .returning();
  return x!;
}

/** Approval is NEVER inferred from an email: the owner must confirm and record the evidence. */
export async function setDeliverableStatus(
  ctx: Ctx,
  id: string,
  status: (typeof dealDeliverables.$inferInsert)['status'],
  opts: { evidence?: string } = {},
) {
  const [x] = await ctx.db
    .select()
    .from(dealDeliverables)
    .where(and(eq(dealDeliverables.id, id), eq(dealDeliverables.orgId, ctx.orgId)));
  if (!x) throw notFound('Deliverable');
  if ((status === 'APPROVED' || status === 'ACCEPTED') && !opts.evidence?.trim())
    throw badRequest(
      'Approval needs evidence (e.g. the date and who approved, or a link/quote).',
      undefined,
      'EVIDENCE_REQUIRED',
    );
  const [after] = await ctx.db
    .update(dealDeliverables)
    .set({
      status,
      submittedAt: status === 'SUBMITTED' ? new Date() : x.submittedAt,
      approvedAt: status === 'APPROVED' || status === 'ACCEPTED' ? new Date() : x.approvedAt,
      approvalEvidence: opts.evidence ?? x.approvalEvidence,
      approvalConfirmedBy:
        status === 'APPROVED' || status === 'ACCEPTED' ? ctx.userId : x.approvalConfirmedBy,
      revisionRounds: status === 'CHANGES_REQUESTED' ? x.revisionRounds + 1 : x.revisionRounds,
      updatedAt: new Date(),
    })
    .where(eq(dealDeliverables.id, id))
    .returning();
  if (status === 'APPROVED')
    await emit(ctx.db, ctx.orgId, 'deal.approval_received', { dealId: x.dealId, deliverableId: id });
  await audit(
    ctx,
    'deliverable.status',
    { type: 'deliverable', id },
    { status: x.status },
    { status, evidence: opts.evidence },
  );
  return after!;
}

/**
 * Links a deliverable to the post(s) that fulfil it (and optionally to a specific asset version / platform).
 * Links never change the deliverable's status: approval and publication are tracked independently.
 */
export async function linkDeliverable(
  ctx: Ctx,
  deliverableId: string,
  input: { publicationId?: string | null; assetVersionId?: string | null; platform?: string | null },
) {
  return ctx.db.transaction(async (tx) => {
    const [x] = await tx
      .select()
      .from(dealDeliverables)
      .where(and(eq(dealDeliverables.id, deliverableId), eq(dealDeliverables.orgId, ctx.orgId)));
    if (!x) throw notFound('Deliverable');
    const patch: Partial<typeof dealDeliverables.$inferInsert> = { updatedAt: new Date() };
    if (input.platform !== undefined) patch.platform = input.platform;
    if (input.assetVersionId !== undefined) patch.assetVersionId = input.assetVersionId;
    if (input.publicationId !== undefined) {
      if (input.publicationId === null) {
        await tx.execute(
          sql`update publication_records set deliverable_id = null where deliverable_id = ${deliverableId} and org_id = ${ctx.orgId}`,
        );
        patch.publicationId = null;
      } else {
        const rec = rowsOf<{
          id: string;
          platform: string;
          assetVersionId: string | null;
          other: string | null;
        }>(
          await tx.execute(
            sql`select r.id, sa.platform::text as platform, r.asset_version_id as "assetVersionId", r.deliverable_id as other from publication_records r join social_accounts sa on sa.id = r.social_account_id where r.id = ${input.publicationId} and r.org_id = ${ctx.orgId}`,
          ),
        )[0];
        if (!rec) throw notFound('Publication');
        if (rec.other && rec.other !== deliverableId)
          throw conflict('That post is already linked to another deliverable.', undefined, 'ALREADY_LINKED');
        await tx.execute(
          sql`update publication_records set deliverable_id = ${deliverableId} where id = ${rec.id}`,
        );
        patch.publicationId = rec.id;
        patch.platform ??= x.platform ?? rec.platform;
        if (patch.assetVersionId === undefined && !x.assetVersionId && rec.assetVersionId)
          patch.assetVersionId = rec.assetVersionId;
      }
    }
    const [after] = await tx
      .update(dealDeliverables)
      .set(patch)
      .where(eq(dealDeliverables.id, deliverableId))
      .returning();
    await audit(
      { ...ctx, db: tx },
      'deliverable.link',
      { type: 'deliverable', id: deliverableId },
      undefined,
      {
        publicationId: input.publicationId ?? null,
      },
    );
    return after!;
  });
}

/** Posts that can be attached to a deliverable (not removed, not already used by another one). */
export async function listLinkablePublications(ctx: Ctx, deliverableId?: string) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select r.id, r.title, r.state, r.state_provenance as provenance, r.canonical_url as url, r.published_at as "publishedAt",
             sa.platform, sa.handle, r.deliverable_id as "deliverableId"
      from publication_records r join social_accounts sa on sa.id = r.social_account_id
      where r.org_id = ${ctx.orgId} and r.state <> 'REMOVED'
        and (r.deliverable_id is null ${deliverableId ? sql`or r.deliverable_id = ${deliverableId}` : sql``})
      order by coalesce(r.published_at, r.planned_at, r.created_at) desc limit 200`),
  );
}

export async function getDeal(ctx: Ctx, id: string) {
  const [d] = await ctx.db
    .select()
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.orgId, ctx.orgId), isNull(deals.deletedAt)));
  if (!d) throw notFound('Deal');
  const deliverables = await ctx.db
    .select()
    .from(dealDeliverables)
    .where(eq(dealDeliverables.dealId, id))
    .orderBy(asc(dealDeliverables.dueAt));
  const linked = deliverables.length
    ? rowsOf<any>(
        await ctx.db.execute(
          sql`select r.id, r.deliverable_id as "deliverableId", r.title, r.state, r.state_provenance as provenance, r.canonical_url as url, r.published_at as "publishedAt", sa.platform, sa.handle
              from publication_records r join social_accounts sa on sa.id = r.social_account_id
              where r.deliverable_id in (${sql.join(
                deliverables.map((x) => sql`${x.id}::uuid`),
                sql`, `,
              )}) order by r.created_at`,
        ),
      )
    : [];
  const inv = await ctx.db
    .select()
    .from(invoices)
    .where(eq(invoices.dealId, id))
    .orderBy(desc(invoices.createdAt));
  const pays = inv.length
    ? rowsOf<any>(
        await ctx.db.execute(
          sql`select * from payments where invoice_id in (${sql.join(
            inv.map((i) => sql`${i.id}::uuid`),
            sql`, `,
          )}) order by received_at`,
        ),
      )
    : [];
  const threads = await ctx.db
    .select({
      id: conversationThreads.id,
      subject: conversationThreads.subject,
      state: conversationThreads.state,
    })
    .from(conversationThreads)
    .where(eq(conversationThreads.dealId, id));
  const exp = await ctx.db.select().from(expenses).where(eq(expenses.dealId, id));
  const invoiced = inv
    .filter((i) => i.status !== 'VOID' && i.status !== 'DRAFT')
    .reduce((s, i) => s + i.amountMinor, 0);
  const received = inv.reduce((s, i) => s + i.paidTotalMinor, 0);
  return {
    ...d,
    deliverables: deliverables.map((x) => ({
      ...x,
      publications: linked.filter((p) => p.deliverableId === x.id),
    })),
    invoices: inv.map((i) => ({ ...i, payments: pays.filter((p: any) => p.invoice_id === i.id) })),
    threads,
    expenses: exp,
    summary: {
      currency: d.currency,
      contractedMinor: d.contractedValueMinor,
      invoicedMinor: invoiced,
      receivedMinor: received,
      outstandingMinor: Math.max(0, invoiced - received),
    },
  };
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

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  taxPercent: number;
}

function priceLines(lines: InvoiceLineInput[]) {
  if (!lines.length) throw badRequest('Add at least one line.');
  let subtotalMinor = 0;
  let taxMinor = 0;
  const rows = lines.map((line, ordinal) => {
    const description = line.description.trim();
    if (!description) throw badRequest('Each line needs a description.');
    if (!Number.isFinite(line.quantity) || line.quantity <= 0)
      throw badRequest('Quantity must be greater than zero.');
    if (!Number.isInteger(line.unitPriceMinor) || line.unitPriceMinor < 0)
      throw badRequest('Unit price must be zero or more.');
    if (!Number.isFinite(line.taxPercent) || line.taxPercent < 0 || line.taxPercent > 100)
      throw badRequest('Tax percent must be between 0 and 100.');
    const net = Math.round(line.quantity * line.unitPriceMinor);
    const tax = Math.round((net * line.taxPercent) / 100);
    subtotalMinor += net;
    taxMinor += tax;
    return {
      ordinal,
      description,
      quantity: line.quantity.toFixed(4),
      unitPriceMinor: line.unitPriceMinor,
      taxPercent: line.taxPercent.toFixed(4),
      netMinor: net,
      taxMinor: tax,
      amountMinor: net + tax,
    };
  });
  const amountMinor = subtotalMinor + taxMinor;
  if (amountMinor <= 0) throw badRequest('The invoice total must be greater than zero.');
  return { rows, subtotalMinor, taxMinor, amountMinor };
}

async function replaceInvoiceLines(tx: Executor, invoiceId: string, lines: InvoiceLineInput[]) {
  const priced = priceLines(lines);
  await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  await tx.insert(invoiceLines).values(
    priced.rows.map((row) => ({
      invoiceId,
      ordinal: row.ordinal,
      description: row.description,
      quantity: row.quantity,
      unitPriceMinor: row.unitPriceMinor,
      taxPercent: row.taxPercent,
    })),
  );
  return priced;
}

async function nextInvoiceNo(tx: Executor, orgId: string, year: number) {
  const r = rowsOf<{ n: number }>(
    await tx.execute(
      sql`select coalesce(max(substring(invoice_no from '^INV-${sql.raw(String(year))}-(\\d+)$')::int), 0)::int as n from invoices where org_id = ${orgId}`,
    ),
  );
  return `INV-${year}-${String((r[0]?.n ?? 0) + 1).padStart(4, '0')}`;
}

export async function createInvoice(
  ctx: Ctx,
  input: {
    dealId?: string | null;
    invoiceNo?: string;
    amountMinor?: number;
    currency?: string;
    issuedAt?: Date | string | null;
    dueAt?: Date | string | null;
    termsDays?: number;
    notes?: string | null;
    draft?: boolean;
    billFrom?: string | null;
    billTo?: string | null;
    bankDetails?: string | null;
    lines?: InvoiceLineInput[];
  },
) {
  const priced = input.lines?.length ? priceLines(input.lines) : null;
  const amountMinor = priced?.amountMinor ?? input.amountMinor;
  if (amountMinor == null || !Number.isInteger(amountMinor) || amountMinor <= 0)
    throw badRequest('Amount must be a positive whole number of minor units (e.g. cents)');
  return ctx.db.transaction(async (tx) => {
    let currency = input.currency;
    let termsDays = input.termsDays;
    if (input.dealId) {
      const [d] = await tx
        .select()
        .from(deals)
        .where(and(eq(deals.id, input.dealId), eq(deals.orgId, ctx.orgId)));
      if (!d) throw notFound('Deal');
      currency ??= d.currency;
      termsDays ??= d.paymentTermsDays ?? undefined;
    }
    currency = (currency ?? 'USD').toUpperCase();
    const issuedAt = input.issuedAt ? new Date(input.issuedAt) : input.draft ? null : new Date();
    const dueAt = input.dueAt
      ? new Date(input.dueAt)
      : issuedAt && termsDays
        ? new Date(issuedAt.getTime() + termsDays * 86400_000)
        : null;
    const invoiceNo =
      input.invoiceNo?.trim() ||
      (await nextInvoiceNo(tx, ctx.orgId, (issuedAt ?? new Date()).getUTCFullYear()));
    const [dup] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.invoiceNo, invoiceNo)));
    if (dup) throw conflict(`Invoice number ${invoiceNo} already exists.`, undefined, 'DUPLICATE_INVOICE_NO');
    const [i] = await tx
      .insert(invoices)
      .values({
        orgId: ctx.orgId,
        dealId: input.dealId ?? null,
        invoiceNo,
        issuedAt,
        dueAt,
        currency,
        amountMinor,
        status: input.draft ? 'DRAFT' : 'ISSUED',
        notes: input.notes ?? null,
        billFrom: input.billFrom?.trim() || null,
        billTo: input.billTo?.trim() || null,
        bankDetails: input.bankDetails?.trim() || null,
      })
      .returning();
    if (priced) await replaceInvoiceLines(tx, i!.id, input.lines!);
    await audit({ ...ctx, db: tx }, 'invoice.create', { type: 'invoice', id: i!.id }, undefined, {
      invoiceNo,
      amountMinor,
      currency,
    });
    return i!;
  });
}

export async function issueInvoice(ctx: Ctx, id: string, dueAt?: Date | null) {
  const [i] = await ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)));
  if (!i) throw notFound('Invoice');
  if (i.status !== 'DRAFT') throw conflict('Only draft invoices can be issued.');
  const [after] = await ctx.db
    .update(invoices)
    .set({ status: 'ISSUED', issuedAt: new Date(), dueAt: dueAt ?? i.dueAt, updatedAt: new Date() })
    .where(eq(invoices.id, id))
    .returning();
  return after!;
}

/** The owner picks a status. Issued still becomes Overdue here when the due date has already passed. */
export async function setInvoiceStatus(ctx: Ctx, id: string, choice: string) {
  const picked = INVOICE_STATUS_CHOICES.find((status) => status === choice);
  if (!picked) throw badRequest('Choose Issued, Confirmed, Paid, Sent, Overdue or Void.');
  return ctx.db.transaction(async (tx) => {
    const [i] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)))
      .for('update');
    if (!i) throw notFound('Invoice');
    if (picked === 'VOID' && i.paidTotalMinor > 0)
      throw conflict('An invoice with payments cannot be voided.', undefined, 'HAS_PAYMENTS');
    const pastDue = i.dueAt != null && i.dueAt.getTime() < Date.now() && i.paidTotalMinor < i.amountMinor;
    const status = picked === 'ISSUED' && pastDue ? 'OVERDUE' : picked;
    const [after] = await tx
      .update(invoices)
      .set({ status, updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();
    await audit(
      { ...ctx, db: tx },
      'invoice.status',
      { type: 'invoice', id },
      { status: i.status },
      { status },
    );
    if (status === 'OVERDUE' && i.status !== 'OVERDUE')
      await emit(tx, ctx.orgId, 'invoice.overdue', { invoiceId: id, dealId: i.dealId });
    return after!;
  });
}

function linesMatchingAmount(
  lines: {
    description: string;
    quantity: string | number;
    unitPriceMinor: number;
    taxPercent: string | number;
  }[],
  amountMinor: number,
): InvoiceLineInput[] | null {
  if (!lines.length) return null;
  const input: InvoiceLineInput[] = lines.map((line) => ({
    description: line.description,
    quantity: Number(line.quantity),
    unitPriceMinor: Math.round(Number(line.unitPriceMinor)),
    taxPercent: Number(line.taxPercent),
  }));
  try {
    if (priceLines(input).amountMinor === amountMinor) return input;
  } catch {
    // A line that cannot be priced is replaced by one line for the chosen amount.
  }
  const description =
    (input.length === 1
      ? input[0]!.description
      : input
          .map((line) => line.description)
          .filter(Boolean)
          .join('; ')
    ).slice(0, 2000) || 'Invoice';
  return [{ description, quantity: 1, unitPriceMinor: amountMinor, taxPercent: 0 }];
}

/**
 * The first part keeps this invoice number. Each later part is a new invoice: same deal, currency and billing
 * details, with the amount and due date given here and the next invoice number.
 */
export async function splitInvoice(
  ctx: Ctx,
  id: string,
  parts: { amountMinor: number; dueAt?: Date | string | null }[],
) {
  if (parts.length < 2) throw badRequest('Enter the amount and due date for the new invoice.');
  if (parts.length > 6) throw badRequest('Split into at most six invoices.');
  for (const part of parts) {
    if (!Number.isInteger(part.amountMinor) || part.amountMinor <= 0)
      throw badRequest('Each amount must be greater than zero.');
  }
  return ctx.db.transaction(async (tx) => {
    const [i] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)))
      .for('update');
    if (!i) throw notFound('Invoice');
    if (i.status === 'VOID') throw conflict('A void invoice cannot be split.', undefined, 'INVOICE_VOID');
    if (parts[0]!.amountMinor < i.paidTotalMinor)
      throw conflict(
        'The amount kept on this invoice cannot be lower than what was already received.',
        undefined,
        'BELOW_PAID',
      );
    const stored = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id))
      .orderBy(asc(invoiceLines.ordinal));
    const applyLines = async (invoiceId: string, amountMinor: number) => {
      const fitted = linesMatchingAmount(stored, amountMinor);
      if (fitted) await replaceInvoiceLines(tx, invoiceId, fitted);
    };
    const dueOf = (value: Date | string | null | undefined) =>
      value === undefined ? i.dueAt : value ? new Date(value) : null;
    const firstDue = dueOf(parts[0]!.dueAt);
    const firstStatus = deriveInvoiceStatus({
      status: i.status,
      amountMinor: parts[0]!.amountMinor,
      paidMinor: i.paidTotalMinor,
      dueAt: firstDue,
    });
    await applyLines(i.id, parts[0]!.amountMinor);
    const [kept] = await tx
      .update(invoices)
      .set({
        amountMinor: parts[0]!.amountMinor,
        dueAt: firstDue,
        status: firstStatus,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, i.id))
      .returning();
    const created = [];
    for (const part of parts.slice(1)) {
      const dueAt = dueOf(part.dueAt);
      const invoiceNo = await nextInvoiceNo(tx, ctx.orgId, (i.issuedAt ?? new Date()).getUTCFullYear());
      const status = deriveInvoiceStatus({
        status: 'ISSUED',
        amountMinor: part.amountMinor,
        paidMinor: 0,
        dueAt,
      });
      const [row] = await tx
        .insert(invoices)
        .values({
          orgId: ctx.orgId,
          dealId: i.dealId,
          invoiceNo,
          issuedAt: i.issuedAt,
          dueAt,
          currency: i.currency,
          amountMinor: part.amountMinor,
          status,
          notes: i.notes,
          billFrom: i.billFrom,
          billTo: i.billTo,
          bankDetails: i.bankDetails,
          isDemo: i.isDemo,
        })
        .returning();
      await applyLines(row!.id, part.amountMinor);
      created.push(row!);
    }
    await audit({ ...ctx, db: tx }, 'invoice.split', { type: 'invoice', id }, undefined, {
      kept: kept!.invoiceNo,
      created: created.map((row) => row.invoiceNo),
    });
    return { invoice: kept!, created };
  });
}

export async function voidInvoice(ctx: Ctx, id: string) {
  const [i] = await ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)));
  if (!i) throw notFound('Invoice');
  if (i.paidTotalMinor > 0)
    throw conflict('An invoice with payments cannot be voided.', undefined, 'HAS_PAYMENTS');
  const [after] = await ctx.db
    .update(invoices)
    .set({ status: 'VOID', updatedAt: new Date() })
    .where(eq(invoices.id, id))
    .returning();
  await audit(ctx, 'invoice.void', { type: 'invoice', id });
  return after!;
}

/**
 * Edit an invoice. With payments recorded the currency is frozen and the amount can never drop below what was received; the
 * status is re-derived so an edit cannot leave an invoice looking paid (or unpaid) when the numbers say otherwise.
 */
export async function updateInvoice(
  ctx: Ctx,
  id: string,
  input: {
    invoiceNo?: string;
    amountMinor?: number;
    currency?: string;
    issuedAt?: Date | string | null;
    dueAt?: Date | string | null;
    notes?: string | null;
    dealId?: string | null;
    billFrom?: string | null;
    billTo?: string | null;
    bankDetails?: string | null;
    lines?: InvoiceLineInput[];
  },
) {
  return ctx.db.transaction(async (tx) => {
    const [i] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)))
      .for('update');
    if (!i) throw notFound('Invoice');
    if (i.status === 'VOID') throw conflict('A void invoice cannot be edited.', undefined, 'INVOICE_VOID');
    const set: Partial<typeof invoices.$inferInsert> = { updatedAt: new Date() };
    if (input.invoiceNo !== undefined && input.invoiceNo.trim() !== i.invoiceNo) {
      const no = input.invoiceNo.trim();
      if (!no) throw badRequest('Invoice number cannot be empty');
      const [dup] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.invoiceNo, no)));
      if (dup) throw conflict(`Invoice number ${no} already exists.`, undefined, 'DUPLICATE_INVOICE_NO');
      set.invoiceNo = no;
    }
    const priced = input.lines ? priceLines(input.lines) : null;
    const amount = priced?.amountMinor ?? input.amountMinor ?? i.amountMinor;
    if (priced || input.amountMinor !== undefined) {
      if (!Number.isInteger(amount) || amount <= 0)
        throw badRequest('Amount must be a positive whole number of minor units');
      if (amount < i.paidTotalMinor)
        throw conflict(
          `The amount cannot be lower than the ${i.paidTotalMinor} already received.`,
          undefined,
          'BELOW_PAID',
        );
      set.amountMinor = amount;
    }
    if (input.currency !== undefined && input.currency.toUpperCase() !== i.currency) {
      if (i.paidTotalMinor > 0)
        throw conflict('The currency cannot change once payments exist.', undefined, 'HAS_PAYMENTS');
      set.currency = input.currency.toUpperCase();
    }
    if (input.issuedAt !== undefined) set.issuedAt = input.issuedAt ? new Date(input.issuedAt) : null;
    if (input.dueAt !== undefined) set.dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (input.notes !== undefined) set.notes = input.notes?.slice(0, 2000) ?? null;
    if (input.billFrom !== undefined) set.billFrom = input.billFrom?.trim() || null;
    if (input.billTo !== undefined) set.billTo = input.billTo?.trim() || null;
    if (input.bankDetails !== undefined) set.bankDetails = input.bankDetails?.slice(0, 4000).trim() || null;
    if (priced) await replaceInvoiceLines(tx, id, input.lines!);
    if (input.dealId !== undefined) {
      if (input.dealId) {
        const [d] = await tx
          .select({ id: deals.id })
          .from(deals)
          .where(and(eq(deals.id, input.dealId), eq(deals.orgId, ctx.orgId)));
        if (!d) throw notFound('Deal');
      }
      set.dealId = input.dealId;
    }
    set.status = deriveInvoiceStatus({
      status: i.status,
      amountMinor: amount,
      paidMinor: i.paidTotalMinor,
      dueAt: set.dueAt === undefined ? i.dueAt : (set.dueAt as Date | null),
    });
    const [after] = await tx.update(invoices).set(set).where(eq(invoices.id, id)).returning();
    await audit({ ...ctx, db: tx }, 'invoice.update', { type: 'invoice', id }, undefined, {
      fields: Object.keys(set).filter((k) => k !== 'updatedAt'),
    });
    return after!;
  });
}

/** Deleting is only for invoices with no money recorded against them; otherwise void it so the history stays honest. */
export async function deleteInvoice(ctx: Ctx, id: string) {
  return ctx.db.transaction(async (tx) => {
    const [i] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)))
      .for('update');
    if (!i) throw notFound('Invoice');
    const [p] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.invoiceId, id))
      .limit(1);
    if (p || i.paidTotalMinor > 0)
      throw conflict(
        'This invoice has payments recorded, so it cannot be deleted. Void it instead.',
        undefined,
        'HAS_PAYMENTS',
      );
    await tx.delete(invoices).where(eq(invoices.id, id));
    await audit(
      { ...ctx, db: tx },
      'invoice.delete',
      { type: 'invoice', id },
      { invoiceNo: i.invoiceNo, amountMinor: i.amountMinor },
      undefined,
    );
    return { id, deleted: true };
  });
}

/**
 * Payment recording is transactional and currency-safe: the row lock stops two concurrent payments both
 * "completing" the invoice, amounts are integer minor units, a payment must be in the invoice currency, and overpayment is refused.
 */
export async function recordPayment(
  ctx: Ctx,
  invoiceId: string,
  input: {
    amountMinor: number;
    currency?: string;
    receivedAt?: Date | string;
    method?: (typeof payments.$inferInsert)['method'];
    reference?: string | null;
    notes?: string | null;
    verified?: boolean;
    allowOverpay?: boolean;
  },
) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0)
    throw badRequest('Payment amount must be a positive whole number of minor units');
  return ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`select 1 from invoices where id = ${invoiceId} and org_id = ${ctx.orgId} for update`,
    );
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, ctx.orgId)));
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'VOID' || inv.status === 'DRAFT')
      throw conflict(`Cannot record a payment on a ${inv.status.toLowerCase()} invoice.`);
    const currency = (input.currency ?? inv.currency).toUpperCase();
    if (currency !== inv.currency)
      throw badRequest(
        `Payment currency ${currency} does not match invoice currency ${inv.currency}. Record the amount in ${inv.currency} (with the FX rate in notes).`,
        undefined,
        'CURRENCY_MISMATCH',
      );
    const newPaid = inv.paidTotalMinor + input.amountMinor;
    if (newPaid > inv.amountMinor && !input.allowOverpay)
      throw conflict(
        'This payment would exceed the invoice amount.',
        { dueMinor: inv.amountMinor - inv.paidTotalMinor },
        'OVERPAYMENT',
      );
    const [p] = await tx
      .insert(payments)
      .values({
        orgId: ctx.orgId,
        invoiceId,
        amountMinor: input.amountMinor,
        currency,
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
        method: input.method ?? 'OTHER',
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        verified: input.verified ?? false,
        provenance: 'USER_ENTERED',
      })
      .returning();
    const status = deriveInvoiceStatus({
      status: inv.status,
      amountMinor: inv.amountMinor,
      paidMinor: newPaid,
      dueAt: inv.dueAt,
    });
    const [after] = await tx
      .update(invoices)
      .set({ paidTotalMinor: newPaid, status, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId))
      .returning();
    if (status === 'PAID') await emit(tx, ctx.orgId, 'invoice.paid', { invoiceId, dealId: inv.dealId });
    await audit({ ...ctx, db: tx }, 'payment.record', { type: 'invoice', id: invoiceId }, undefined, {
      amountMinor: input.amountMinor,
      currency,
    });
    return { payment: p!, invoice: after! };
  });
}

/** Worker job: flips overdue invoices and emits invoice.overdue once per transition. */
export async function refreshInvoiceStatuses(db: Ctx['db'], orgId: string, now = new Date()) {
  const rows = rowsOf<{ id: string; dealId: string | null }>(
    await db.execute(
      sql`update invoices set status = 'OVERDUE', updated_at = now() where org_id = ${orgId} and status in ('ISSUED','PARTIALLY_PAID') and due_at is not null and due_at < ${now.toISOString()}::timestamptz and paid_total_minor < amount_minor returning id, deal_id as "dealId"`,
    ),
  );
  for (const r of rows) await emit(db, orgId, 'invoice.overdue', { invoiceId: r.id, dealId: r.dealId });
  return { overdue: rows.length };
}

export async function setFxRate(
  ctx: Ctx,
  input: { base: string; quote: string; rate: number; rateDate: Date | string; source?: string },
) {
  if (!(input.rate > 0)) throw badRequest('Rate must be positive');
  const [r] = await ctx.db
    .insert(fxRates)
    .values({
      orgId: ctx.orgId,
      baseCurrency: input.base.toUpperCase(),
      quoteCurrency: input.quote.toUpperCase(),
      rate: String(input.rate),
      rateDate: new Date(input.rateDate),
      source: input.source ?? 'manual',
    })
    .onConflictDoUpdate({
      target: [fxRates.orgId, fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.rateDate],
      set: { rate: String(input.rate), source: input.source ?? 'manual' },
    })
    .returning();
  return r!;
}

/** Finance totals stay per currency. A converted grand total is offered only when a dated FX rate exists for every currency used. */
export async function financeSummary(ctx: Ctx, range: { from?: Date; to?: Date } = {}) {
  const from = range.from ?? new Date(0);
  const to = range.to ?? new Date(Date.now() + 86400_000);
  const base =
    rowsOf<{ baseCurrency: string }>(
      await ctx.db.execute(
        sql`select base_currency as "baseCurrency" from organizations where id = ${ctx.orgId}`,
      ),
    )[0]?.baseCurrency ?? 'CAD';
  const q = async (query: ReturnType<typeof sql>) =>
    rowsOf<{ currency: string; n: number }>(await ctx.db.execute(query));
  const received = await q(
    sql`select p.currency, sum(p.amount_minor)::float8 as n from payments p where p.org_id = ${ctx.orgId} and p.received_at >= ${from.toISOString()}::timestamptz and p.received_at < ${to.toISOString()}::timestamptz group by 1`,
  );
  const outstanding = await q(
    sql`select currency, sum(amount_minor - paid_total_minor)::float8 as n from invoices where org_id = ${ctx.orgId} and status in ('ISSUED','SENT','CONFIRMED','PARTIALLY_PAID','OVERDUE') group by 1`,
  );
  const overdue = await q(
    sql`select currency, sum(amount_minor - paid_total_minor)::float8 as n from invoices where org_id = ${ctx.orgId} and status = 'OVERDUE' group by 1`,
  );
  const spent = await q(
    sql`select currency, sum(amount_minor)::float8 as n from expenses where org_id = ${ctx.orgId} and incurred_at >= ${from.toISOString()}::timestamptz and incurred_at < ${to.toISOString()}::timestamptz group by 1`,
  );
  const rates = await ctx.db
    .select()
    .from(fxRates)
    .where(eq(fxRates.orgId, ctx.orgId))
    .orderBy(desc(fxRates.rateDate));
  const currencies = new Set([...received, ...outstanding, ...overdue, ...spent].map((r) => r.currency));
  const rateFor = (cur: string) =>
    cur === base
      ? { rate: 1, date: null as Date | null }
      : (() => {
          const r = rates.find((x) => x.baseCurrency === cur && x.quoteCurrency === base);
          return r ? { rate: Number(r.rate), date: r.rateDate } : undefined;
        })();
  const missing = [...currencies].filter((c) => !rateFor(c));
  const toMap = (rows: { currency: string; n: number }[]) =>
    Object.fromEntries(rows.map((r) => [r.currency, r.n]));
  const conv = (rows: { currency: string; n: number }[]) =>
    missing.length ? null : Math.round(rows.reduce((s, r) => s + r.n * rateFor(r.currency)!.rate, 0));
  return {
    baseCurrency: base,
    perCurrency: {
      received: toMap(received),
      outstanding: toMap(outstanding),
      overdue: toMap(overdue),
      expenses: toMap(spent),
    },
    converted: missing.length
      ? null
      : {
          receivedMinor: conv(received),
          outstandingMinor: conv(outstanding),
          overdueMinor: conv(overdue),
          expensesMinor: conv(spent),
          rates: [...currencies].map((c) => ({ currency: c, ...rateFor(c) })),
        },
    missingFxRates: missing,
  };
}

export async function listInvoices(ctx: Ctx, q: { status?: string; dealId?: string; limit?: number } = {}) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select i.id, i.invoice_no as "invoiceNo", i.status, i.currency, i.amount_minor::float8 as "amountMinor", i.issued_at as "issuedAt", i.due_at as "dueAt", i.deal_id as "dealId", d.title as "dealTitle", i.notes,
             coalesce((select sum(p.amount_minor) from payments p where p.invoice_id = i.id), 0)::float8 as "paidMinor",
             o.base_currency as "baseCurrency",
             case when i.currency = o.base_currency then 1 else fx.rate::float8 end as "fxRate",
             fx.created_at as "fxAt", fx.source as "fxSource",
             case when i.currency = o.base_currency then i.amount_minor::float8
                  when fx.rate is not null then round(i.amount_minor * fx.rate)::float8 end as "baseAmountMinor"
      from invoices i left join deals d on d.id = i.deal_id
      join organizations o on o.id = i.org_id
      left join lateral (select f.rate, f.created_at, f.source from fx_rates f
                         where f.org_id = i.org_id and f.base_currency = i.currency and f.quote_currency = o.base_currency
                         order by f.rate_date desc, f.created_at desc limit 1) fx on true
      where i.org_id = ${ctx.orgId} ${q.status ? sql`and i.status = ${q.status}::invoice_status` : sql``} ${q.dealId ? sql`and i.deal_id = ${q.dealId}` : sql``}
      order by i.issued_at desc nulls last, i.created_at desc limit ${Math.min(q.limit ?? 100, 500)}`),
  );
}

export async function getInvoice(ctx: Ctx, id: string) {
  const [i] = await ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)));
  if (!i) throw notFound('Invoice');
  const pays = await ctx.db
    .select()
    .from(payments)
    .where(eq(payments.invoiceId, id))
    .orderBy(asc(payments.receivedAt));
  const lines = await ctx.db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(asc(invoiceLines.ordinal));
  return { ...i, payments: pays, lines };
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
