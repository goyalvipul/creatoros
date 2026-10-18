import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, int8, pk, ts, updatedAt } from './columns';
import {
  actionableState,
  compensationType,
  contractStatus,
  dealStage,
  deliverableStatus,
  expenseCategory,
  externalOrgKind,
  invoiceStatus,
  messageDirection,
  messageSource,
  paymentMethod,
  priority,
  provenance,
  triageState,
} from './enums';
import { brands, channels, orgRef, providerConnections, users } from './identity';
import { assetVersions } from './storage';
import { creativeProjects } from './production';
import { publicationRecords } from './publishing';

export const externalOrganizations = pgTable(
  'external_organizations',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    kind: externalOrgKind('kind').notNull().default('BRAND'),
    website: text('website'),
    sector: text('sector'),
    handles: jsonb('handles').$type<Record<string, string>>().notNull().default({}),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('external_orgs_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: pk(),
    orgId: orgRef(),
    externalOrgId: uuid('external_org_id').references(() => externalOrganizations.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    emails: text('emails')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    handles: jsonb('handles').$type<Record<string, string>>().notNull().default({}),
    websites: text('websites')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    timezone: text('timezone'),
    preferredComms: text('preferred_comms'),
    replySlaHours: integer('reply_sla_hours'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('contacts_org_idx').on(t.orgId), index('contacts_ext_org_idx').on(t.externalOrgId)],
);

export const conversationThreads = pgTable(
  'conversation_threads',
  {
    id: pk(),
    orgId: orgRef(),
    providerConnectionId: uuid('provider_connection_id').references(() => providerConnections.id, {
      onDelete: 'set null',
    }),
    source: messageSource('source').notNull().default('MANUAL'),
    principal: text('principal'),
    providerThreadId: text('provider_thread_id'),
    subject: text('subject'),
    externalOrgId: uuid('external_org_id').references(() => externalOrganizations.id, {
      onDelete: 'set null',
    }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    opportunityId: uuid('opportunity_id').references((): AnyPgColumn => opportunities.id, {
      onDelete: 'set null',
    }),
    dealId: uuid('deal_id').references((): AnyPgColumn => deals.id, { onDelete: 'set null' }),
    triageState: triageState('triage_state').notNull().default('POSSIBLE'),
    state: actionableState('state').notNull().default('NEED_REPLY'),
    lastInboundAt: ts('last_inbound_at'),
    lastOutboundAt: ts('last_outbound_at'),
    lastAnsweredAt: ts('last_answered_at'),
    snoozeUntil: ts('snooze_until'),
    lastCheckedAt: ts('last_checked_at'),
    externalLink: text('external_link'),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => conversationThreads.id, {
      onDelete: 'set null',
    }),
    isDemo: boolean('is_demo').notNull().default(false),
    // Socials: who the other party is, what kind of thread it is, and local organisation. `principal` is the receiving account id.
    participantId: text('participant_id'),
    participantName: text('participant_name'),
    kind: text('kind').notNull().default('DM'), // DM | COMMENT | EMAIL
    labels: text('labels')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    priority: text('priority').notNull().default('NORMAL'),
    optedOut: boolean('opted_out').notNull().default(false),
    starred: boolean('starred').notNull().default(false),
    archivedLocal: boolean('archived_local').notNull().default(false),
    // "What do I reply to" suggestion from the other person's latest message (domain triageReply). Null until computed.
    replyCategory: text('reply_category'),
    internalNotes: text('internal_notes'),
    followUpAt: ts('follow_up_at'),
    providerMediaId: text('provider_media_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('conversation_threads_provider_uq')
      .on(t.orgId, t.source, t.principal, t.providerThreadId)
      .where(sql`${t.providerThreadId} is not null`),
    index('conversation_threads_state_idx').on(t.orgId, t.state),
    index('conversation_threads_triage_idx').on(t.orgId, t.triageState),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: pk(),
    orgId: orgRef(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => conversationThreads.id, { onDelete: 'cascade' }),
    source: messageSource('source').notNull().default('MANUAL'),
    principal: text('principal'),
    providerMsgId: text('provider_msg_id'),
    direction: messageDirection('direction').notNull().default('INBOUND'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    fromEmail: text('from_email'),
    fromName: text('from_name'),
    toEmails: text('to_emails')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    subject: text('subject'),
    bodyPreview: text('body_preview'),
    bodyEnc: text('body_enc'),
    isRead: boolean('is_read').notNull().default(false),
    attachmentRefs: jsonb('attachment_refs')
      .$type<{ name: string; mime?: string; sizeBytes?: number; ref?: string }[]>()
      .notNull()
      .default([]),
    rawChecksum: text('raw_checksum').notNull(),
    provenance: provenance('provenance').notNull().default('USER_ENTERED'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('messages_provider_uq')
      .on(t.orgId, t.source, t.principal, t.providerMsgId)
      .where(sql`${t.providerMsgId} is not null`),
    uniqueIndex('messages_checksum_uq').on(t.orgId, t.threadId, t.rawChecksum),
    index('messages_thread_idx').on(t.threadId, t.receivedAt),
  ],
);

export const inboundClassifications = pgTable(
  'inbound_classifications',
  {
    id: pk(),
    orgId: orgRef(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    extracted: jsonb('extracted').$type<Record<string, unknown>>().notNull().default({}),
    signals: jsonb('signals').$type<string[]>().notNull().default([]),
    confidence: doublePrecision('confidence').notNull().default(0),
    algorithm: text('algorithm').notNull().default('rules-v1'),
    reviewOutcome: text('review_outcome').notNull().default('PENDING'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: ts('reviewed_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('inbound_classifications_msg_uq').on(t.messageId, t.algorithm)],
);

export const opportunities = pgTable(
  'opportunities',
  {
    id: pk(),
    orgId: orgRef(),
    sourceThreadId: uuid('source_thread_id').references((): AnyPgColumn => conversationThreads.id, {
      onDelete: 'set null',
    }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    externalOrgId: uuid('external_org_id').references(() => externalOrganizations.id, {
      onDelete: 'set null',
    }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    offerType: compensationType('offer_type').notNull().default('UNKNOWN'),
    stage: dealStage('stage').notNull().default('NEW_INQUIRY'),
    predictedValueMinor: int8('predicted_value_minor'),
    currency: text('currency').notNull().default('USD'),
    probabilityPct: integer('probability_pct'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('opportunities_thread_uq')
      .on(t.sourceThreadId)
      .where(sql`${t.sourceThreadId} is not null and ${t.deletedAt} is null`),
    index('opportunities_org_stage_idx').on(t.orgId, t.stage),
  ],
);

export const deals = pgTable(
  'deals',
  {
    id: pk(),
    orgId: orgRef(),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
    externalOrgId: uuid('external_org_id').references(() => externalOrganizations.id, {
      onDelete: 'set null',
    }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    campaign: text('campaign'),
    pitch: text('pitch'),
    stage: dealStage('stage').notNull().default('NEW_INQUIRY'),
    compensationType: compensationType('compensation_type').notNull().default('UNKNOWN'),
    contractedValueMinor: int8('contracted_value_minor'),
    currency: text('currency').notNull().default('USD'),
    taxTerms: text('tax_terms'),
    usageRights: text('usage_rights'),
    exclusivity: text('exclusivity'),
    territories: text('territories'),
    embargoUntil: ts('embargo_until'),
    licensing: text('licensing'),
    deliverablesSummary: text('deliverables_summary'),
    revisionRounds: integer('revision_rounds').notNull().default(1),
    contractStatus: contractStatus('contract_status').notNull().default('NONE'),
    signedAt: ts('signed_at'),
    internalNotes: text('internal_notes'),
    priority: priority('priority').notNull().default('NORMAL'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    paymentTerms: text('payment_terms'),
    paymentTermsDays: integer('payment_terms_days'),
    budgetMinor: int8('budget_minor'),
    costMinor: int8('cost_minor'),
    expectedMarginPct: numeric('expected_margin_pct', { precision: 6, scale: 2 }),
    nextDueAt: ts('next_due_at'),
    approvalRules: text('approval_rules'),
    stageChangedAt: ts('stage_changed_at').notNull().defaultNow(),
    closedAt: ts('closed_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('deals_org_stage_idx').on(t.orgId, t.stage), index('deals_due_idx').on(t.orgId, t.nextDueAt)],
);

export const dealDeliverables = pgTable(
  'deal_deliverables',
  {
    id: pk(),
    orgId: orgRef(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    projectId: uuid('project_id').references(() => creativeProjects.id, { onDelete: 'set null' }),
    assetVersionId: uuid('asset_version_id').references(() => assetVersions.id, { onDelete: 'set null' }),
    publicationId: uuid('publication_id').references((): AnyPgColumn => publicationRecords.id, {
      onDelete: 'set null',
    }),
    format: text('format'),
    platform: text('platform'),
    quantity: integer('quantity').notNull().default(1),
    specs: text('specs'),
    dueAt: ts('due_at'),
    submittedAt: ts('submitted_at'),
    approvedAt: ts('approved_at'),
    approvalEvidence: text('approval_evidence'),
    approvalConfirmedBy: uuid('approval_confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    status: deliverableStatus('status').notNull().default('PLANNED'),
    revisionRounds: integer('revision_rounds').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('deal_deliverables_deal_idx').on(t.dealId),
    index('deal_deliverables_due_idx').on(t.orgId, t.dueAt),
  ],
);

export const dealContracts = pgTable('deal_contracts', {
  id: pk(),
  orgId: orgRef(),
  dealId: uuid('deal_id')
    .notNull()
    .references(() => deals.id, { onDelete: 'cascade' }),
  documentRef: text('document_ref'),
  effectiveAt: ts('effective_at'),
  expiresAt: ts('expires_at'),
  rights: text('rights'),
  approvalState: text('approval_state').notNull().default('PENDING'),
  signatureState: contractStatus('signature_state').notNull().default('NONE'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    orgId: orgRef(),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    invoiceNo: text('invoice_no').notNull(),
    issuedAt: ts('issued_at'),
    dueAt: ts('due_at'),
    currency: text('currency').notNull().default('USD'),
    amountMinor: int8('amount_minor').notNull(),
    status: invoiceStatus('status').notNull().default('DRAFT'),
    paidTotalMinor: int8('paid_total_minor').notNull().default(0),
    fileRef: text('file_ref'),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    fxRateDate: ts('fx_rate_date'),
    fxSource: text('fx_source'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('invoices_no_uq').on(t.orgId, t.invoiceNo),
    index('invoices_due_idx').on(t.orgId, t.status, t.dueAt),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    orgId: orgRef(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amountMinor: int8('amount_minor').notNull(),
    currency: text('currency').notNull().default('USD'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    method: paymentMethod('method').notNull().default('OTHER'),
    reference: text('reference'),
    proofRef: text('proof_ref'),
    verified: boolean('verified').notNull().default(false),
    provenance: provenance('provenance').notNull().default('USER_ENTERED'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('payments_invoice_idx').on(t.invoiceId)],
);

export const expenses = pgTable('expenses', {
  id: pk(),
  orgId: orgRef(),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => creativeProjects.id, { onDelete: 'set null' }),
  description: text('description'),
  amountMinor: int8('amount_minor').notNull(),
  currency: text('currency').notNull().default('CAD'),
  category: expenseCategory('category').notNull().default('OTHER'),
  incurredAt: ts('incurred_at').notNull().defaultNow(),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const fxRates = pgTable(
  'fx_rates',
  {
    id: pk(),
    orgId: orgRef(),
    baseCurrency: text('base_currency').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
    rateDate: ts('rate_date').notNull(),
    source: text('source').notNull().default('manual'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('fx_rates_uq').on(t.orgId, t.baseCurrency, t.quoteCurrency, t.rateDate)],
);

export const followUpRules = pgTable(
  'follow_up_rules',
  {
    id: pk(),
    orgId: orgRef(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    sourceType: text('source_type').notNull().default('thread'),
    condition: jsonb('condition').$type<Record<string, unknown>>().notNull().default({}),
    durationHours: integer('duration_hours'),
    enabled: boolean('enabled').notNull().default(true),
    notify: boolean('notify').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('follow_up_rules_key_uq').on(t.orgId, t.key)],
);
