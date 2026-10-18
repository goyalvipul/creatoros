import { scrubText } from '../log-redact';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ACTIONABLE_STATE,
  COMPENSATION_TYPE,
  DEAL_STAGE,
  DELIVERABLE_STATUS,
  GOAL_METRIC,
  GOAL_PERIOD,
  MESSAGE_SOURCE,
  PAYMENT_METHOD,
  PRIORITY,
  PROVIDER,
} from '@creatoros/domain';
import {
  AppError,
  addDeliverable,
  analytics,
  briefing,
  changeDealStage,
  completeAction,
  completeOAuth,
  receiveFacebookWebhook,
  receiveInstagramWebhook,
  verifyMetaHandshake,
  connectorContext,
  convertOpportunityToDeal,
  createAction,
  createBackup,
  createDeal,
  createGoal,
  createInvoice,
  acceptInvoiceSuggestion,
  deleteInvoice,
  dismissInvoiceSuggestion,
  followUpThread,
  createThreadTask,
  listInvoiceSuggestions,
  mailAccounts,
  moveMailThread,
  replyToEmail,
  replyInfo,
  loadFullMessage,
  ensureLiveRates,
  scanEmailInvoices,
  deepScanEmail,
  updateInvoice,
  updateThreadLocal,
  disconnect,
  dismissAction,
  financeSummary,
  getBackup,
  getDeal,
  getInvoice,
  getPrefs,
  getThread,
  goalProgress,
  ingestMessage,
  issueInvoice,
  linkActionToTodo,
  linkSocialAccountToConnection,
  listActions,
  listBackups,
  listContacts,
  listDeals,
  listExternalOrganizations,
  listGoals,
  listIntegrations,
  listInvoices,
  listNotifications,
  listTaskLinks,
  listThreads,
  manualIntake,
  markRead,
  pinAction,
  pipeline,
  recentCompleted,
  recordGoalObservation,
  recordPayment,
  reopenAction,
  requestBackup,
  resolveTodoConflict,
  retryTaskLink,
  runActionsEngine,
  runSync,
  saveKeyConnection,
  search,
  setConnectionPaused,
  linkDeliverable,
  setDeliverableStatus,
  setFxRate,
  setThreadState,
  snapshotAnalytics,
  snoozeAction,
  startOAuth,
  syncTaskLink,
  testConnection,
  todoStatus,
  triageThread,
  unreadCount,
  updateDeal,
  updateExternalOrganization,
  updateGoal,
  updatePrefs,
  voidInvoice,
} from '@creatoros/services';
import { idParam, makeRouter, withMeta, type AppDeps } from '../http';

const date = z.coerce.date();
const uuid = z.uuid();
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const currency = z.string().length(3).toUpperCase();

export function workRoutes(app: FastifyInstance, deps: AppDeps) {
  const route = makeRouter(app, deps);
  const { db, config } = deps;
  const env = config.env;
  const ov = () => deps.overrides ?? {};

  // ================================================================ inbox / collaborations
  route(
    {
      method: 'GET',
      url: '/threads',
      tag: 'Collaborations',
      summary: 'Conversation threads',
      query: z.object({
        state: z.enum(ACTIONABLE_STATE).optional(),
        triage: z.string().max(20).optional(),
        category: z.string().max(40).optional(),
        q: z.string().max(200).optional(),
        dealId: uuid.optional(),
        limit: z.coerce.number().int().max(300).optional(),
        scope: z.enum(['mail', 'all']).optional(),
        connectionId: uuid.optional(),
        folder: z.enum(['inbox', 'starred', 'followup', 'pipeline', 'archived']).optional(),
      }),
    },
    ({ ctx, query }) => listThreads(ctx, query),
  );
  // ---- email inbox organisation (Gmail + pasted mail). Social conversations use /socials/threads/*.
  route(
    {
      method: 'GET',
      url: '/mail/accounts',
      tag: 'Collaborations',
      summary: 'Connected mailboxes with per-tab counts',
    },
    ({ ctx }) => mailAccounts(ctx),
  );
  route(
    {
      method: 'PATCH',
      url: '/threads/:id/local',
      tag: 'Collaborations',
      summary: 'Creator OS-only star / archive for an email (never changes Gmail)',
      params: idParam,
      body: z.object({ starred: z.boolean(), archivedLocal: z.boolean() }).partial(),
    },
    ({ ctx, params, body }) => updateThreadLocal(ctx, params.id, body, { mail: true }),
  );
  route(
    {
      method: 'POST',
      url: '/threads/:id/move',
      tag: 'Collaborations',
      summary: 'Move an email between Inbox, Archive and Pipeline',
      params: idParam,
      body: z.object({ to: z.enum(['INBOX', 'ARCHIVE', 'PIPELINE']) }),
    },
    ({ ctx, params, body }) => moveMailThread(ctx, params.id, body.to),
  );
  route(
    {
      method: 'POST',
      url: '/threads/:id/follow-up',
      tag: 'Collaborations',
      summary: 'Set or clear the follow-up for an email (one open task per conversation)',
      params: idParam,
      body: z.object({
        preset: z.enum(['tomorrow', 'next_week', 'custom', 'clear']),
        at: z.coerce.date().optional(),
      }),
    },
    ({ ctx, params, body }) => followUpThread(ctx, params.id, body, { mail: true }),
  );
  route(
    {
      method: 'POST',
      url: '/threads/:id/create-task',
      tag: 'Collaborations',
      summary: 'Create a task linked to this email (idempotent)',
      params: idParam,
      body: z.object({ title: z.string().max(200).optional(), dueAt: z.coerce.date().nullable().optional() }),
    },
    ({ ctx, params, body }) => createThreadTask(ctx, params.id, body, { mail: true }),
  );
  route(
    {
      method: 'POST',
      url: '/threads/:id/reply',
      tag: 'Collaborations',
      summary: 'Send a reply from the connected Gmail account (explicit action, never retried)',
      params: idParam,
      body: z.object({
        text: z.string().min(1).max(20000),
        requestId: z.string().min(8).max(100),
        messageId: uuid.optional(),
        all: z.boolean().optional(),
        to: z.array(z.string().max(254)).max(20).optional(),
        cc: z.array(z.string().max(254)).max(20).optional(),
        subject: z.string().max(300).optional(),
      }),
    },
    ({ ctx, params, body }) => replyToEmail(ctx, params.id, body, ov()),
  );
  route(
    {
      method: 'GET',
      url: '/threads/:id/messages/:mid/reply-info',
      tag: 'Collaborations',
      summary: 'Prefill (To, Cc, subject) for replying to one specific email',
      params: z.object({ id: uuid, mid: uuid }),
      query: z.object({ all: z.enum(['0', '1']).optional() }),
    },
    ({ ctx, params, query }) => replyInfo(ctx, params.id, params.mid, query.all === '1', ov()),
  );
  route(
    {
      method: 'POST',
      url: '/threads/:id/messages/:mid/full',
      tag: 'Collaborations',
      summary: 'Load and store the complete text of one email from Gmail (read-only)',
      params: z.object({ id: uuid, mid: uuid }),
    },
    ({ ctx, params }) => loadFullMessage(ctx, params.id, params.mid, ov()),
  );
  route(
    {
      method: 'GET',
      url: '/mail/invoice-suggestions',
      tag: 'Collaborations',
      summary: 'Invoices spotted in email text (suggestions only)',
      query: z.object({
        status: z.enum(['SUGGESTED', 'ACCEPTED', 'DISMISSED']).optional(),
        threadId: uuid.optional(),
      }),
    },
    ({ ctx, query }) => listInvoiceSuggestions(ctx, query),
  );
  route(
    {
      method: 'POST',
      url: '/mail/invoice-suggestions/scan',
      tag: 'Collaborations',
      summary: 'Scan stored email text for invoices',
      body: z.object({ connectionId: uuid.optional(), days: z.number().int().min(1).max(3650).optional() }),
    },
    ({ ctx, body }) => deepScanEmail(ctx, body, ov()),
  );
  route(
    {
      method: 'POST',
      url: '/mail/invoice-suggestions/:id/accept',
      tag: 'Collaborations',
      summary: 'Add a suggestion as an invoice (money owed to you) or an expense',
      params: idParam,
      body: z.object({
        as: z.enum(['INVOICE', 'EXPENSE']),
        invoiceNo: z.string().max(40).nullable().optional(),
        amountMinor: z.number().int().positive().optional(),
        currency: currency.optional(),
        dueAt: date.nullable().optional(),
        dealId: uuid.nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => acceptInvoiceSuggestion(ctx, params.id, body),
  );
  route(
    {
      method: 'POST',
      url: '/mail/invoice-suggestions/:id/dismiss',
      tag: 'Collaborations',
      summary: 'Dismiss an invoice suggestion',
      params: idParam,
    },
    ({ ctx, params }) => dismissInvoiceSuggestion(ctx, params.id),
  );
  route(
    {
      method: 'GET',
      url: '/threads/:id',
      tag: 'Collaborations',
      summary: 'Thread with messages and the rules-based classification suggestion',
      params: idParam,
    },
    ({ ctx, params }) => getThread(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/threads/:id/state',
      tag: 'Collaborations',
      summary: 'Set the reply state',
      params: idParam,
      body: z.object({ state: z.enum(ACTIONABLE_STATE), snoozeUntil: date.nullable().optional() }),
    },
    ({ ctx, params, body }) => setThreadState(ctx, params.id, body.state, body.snoozeUntil),
  );
  route(
    {
      method: 'POST',
      url: '/threads/:id/triage',
      tag: 'Collaborations',
      summary: 'Owner confirms, dismisses or merges (a suggestion alone never creates a deal)',
      params: idParam,
      body: z.object({
        outcome: z.enum(['CONFIRMED', 'DISMISSED', 'MERGED']),
        mergeIntoId: uuid.optional(),
        title: z.string().max(200).optional(),
      }),
    },
    ({ ctx, params, body }) =>
      triageThread(ctx, params.id, body.outcome, { mergeIntoId: body.mergeIntoId, title: body.title }),
  );
  route(
    {
      method: 'POST',
      url: '/messages',
      tag: 'Collaborations',
      summary: 'Paste or log a message by hand (idempotent)',
      status: 201,
      body: z.object({
        source: z.enum(MESSAGE_SOURCE).default('MANUAL'),
        direction: z.enum(['INBOUND', 'OUTBOUND']),
        receivedAt: date.default(() => new Date()),
        threadId: uuid.optional(),
        fromEmail: z.string().max(254).nullable().optional(),
        fromName: z.string().max(200).nullable().optional(),
        subject: z.string().max(500).nullable().optional(),
        body: z.string().max(100_000).nullable().optional(),
        externalLink: z.string().url().max(1000).nullable().optional(),
      }),
    },
    ({ ctx, body }) => ingestMessage(ctx, { ...body, provenance: 'USER_ENTERED' } as any),
  );
  route(
    {
      method: 'POST',
      url: '/intake',
      tag: 'Collaborations',
      summary: 'Quick add a collaboration inquiry (becomes a confirmed opportunity)',
      status: 201,
      body: z.object({
        brand: z.string().trim().min(1).max(200),
        contactName: z.string().max(200).optional(),
        contactEmail: z.email().max(254).optional(),
        subject: z.string().trim().min(1).max(300),
        notes: z.string().max(20000).optional(),
        offerType: z.enum(COMPENSATION_TYPE).optional(),
        valueMinor: money.nullable().optional(),
        currency: currency.optional(),
        source: z.enum(MESSAGE_SOURCE).optional(),
      }),
    },
    ({ ctx, body }) => manualIntake(ctx, body),
  );
  route(
    {
      method: 'POST',
      url: '/opportunities/:id/convert',
      tag: 'Collaborations',
      summary: 'Convert an opportunity into a deal (idempotent)',
      params: idParam,
      status: 201,
      body: z.object({
        stage: z.enum(DEAL_STAGE).optional(),
        title: z.string().max(300).optional(),
        compensationType: z.enum(COMPENSATION_TYPE).optional(),
        contractedValueMinor: money.nullable().optional(),
        currency: currency.optional(),
        paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => convertOpportunityToDeal(ctx, params.id, body),
  );

  const dealFields = {
    title: z.string().trim().min(1).max(300),
    brandId: uuid.nullable(),
    channelId: uuid.nullable(),
    compensationType: z.enum(COMPENSATION_TYPE),
    contractedValueMinor: money.nullable(),
    currency,
    paymentTermsDays: z.number().int().min(0).max(365).nullable(),
    priority: z.enum(PRIORITY),
    notes: z.string().max(20000).nullable(),
    nextDueAt: date.nullable(),
  };
  route(
    {
      method: 'GET',
      url: '/deals',
      tag: 'Collaborations',
      summary: 'Deals',
      query: z.object({
        stage: z.enum(DEAL_STAGE).optional(),
        q: z.string().max(200).optional(),
        limit: z.coerce.number().int().max(500).optional(),
      }),
    },
    ({ ctx, query }) => listDeals(ctx, query),
  );
  route(
    {
      method: 'GET',
      url: '/deals/pipeline',
      tag: 'Collaborations',
      summary: 'Pipeline by stage (totals per currency, never summed across currencies)',
    },
    ({ ctx }) => pipeline(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/deals',
      tag: 'Collaborations',
      summary: 'Create a deal',
      status: 201,
      body: z
        .object(dealFields)
        .partial()
        .extend({ title: dealFields.title, stage: z.enum(DEAL_STAGE).optional() }),
    },
    ({ ctx, body }) => createDeal(ctx, body as any),
  );
  route(
    {
      method: 'GET',
      url: '/deals/:id',
      tag: 'Collaborations',
      summary: 'Deal with deliverables, threads, invoices, payments and timeline',
      params: idParam,
    },
    ({ ctx, params }) => getDeal(ctx, params.id),
  );
  route(
    {
      method: 'PATCH',
      url: '/deals/:id',
      tag: 'Collaborations',
      summary: 'Edit a deal',
      params: idParam,
      body: z.object(dealFields).partial(),
    },
    ({ ctx, params, body }) => updateDeal(ctx, params.id, body as any),
  );
  route(
    {
      method: 'POST',
      url: '/deals/:id/stage',
      tag: 'Collaborations',
      summary: 'Move a deal (PAID_CLOSED is blocked while invoices are unpaid)',
      params: idParam,
      body: z.object({
        to: z.enum(DEAL_STAGE),
        reason: z.string().max(500).optional(),
        force: z.boolean().optional(),
      }),
    },
    ({ ctx, params, body }) =>
      changeDealStage(ctx, params.id, body.to, { reason: body.reason, force: body.force }),
  );
  route(
    {
      method: 'POST',
      url: '/deals/:id/deliverables',
      tag: 'Collaborations',
      summary: 'Add a deliverable',
      params: idParam,
      status: 201,
      body: z.object({
        title: z.string().trim().min(1).max(300),
        dueAt: date.nullable().optional(),
        description: z.string().max(5000).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => addDeliverable(ctx, params.id, body as any),
  );
  route(
    {
      method: 'POST',
      url: '/deliverables/:id/status',
      tag: 'Collaborations',
      summary: 'Set deliverable status (APPROVED needs evidence + owner confirmation)',
      params: idParam,
      body: z.object({ status: z.enum(DELIVERABLE_STATUS), evidence: z.string().max(2000).optional() }),
    },
    ({ ctx, params, body }) => setDeliverableStatus(ctx, params.id, body.status, { evidence: body.evidence }),
  );
  route(
    {
      method: 'POST',
      url: '/deliverables/:id/link',
      tag: 'Collaborations',
      summary: 'Link a deliverable to the post that fulfils it (never changes its status)',
      params: idParam,
      body: z.object({
        publicationId: z.string().uuid().nullable().optional(),
        assetVersionId: z.string().uuid().nullable().optional(),
        platform: z.string().max(40).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => linkDeliverable(ctx, params.id, body),
  );
  route(
    {
      method: 'GET',
      url: '/organizations',
      tag: 'Collaborations',
      summary: 'Brands/agencies you work with',
      query: z.object({ q: z.string().max(200).optional() }),
    },
    ({ ctx, query }) => listExternalOrganizations(ctx, query),
  );
  route(
    {
      method: 'PATCH',
      url: '/organizations/:id',
      tag: 'Collaborations',
      summary: 'Edit a partner organization',
      params: idParam,
      body: z.object({
        name: z.string().trim().min(1).max(200).optional(),
        notes: z.string().max(5000).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => updateExternalOrganization(ctx, params.id, body),
  );
  route(
    {
      method: 'GET',
      url: '/contacts',
      tag: 'Collaborations',
      summary: 'Contacts',
      query: z.object({ q: z.string().max(200).optional(), externalOrgId: uuid.optional() }),
    },
    ({ ctx, query }) => listContacts(ctx, query),
  );

  // ================================================================ finance
  route(
    {
      method: 'GET',
      url: '/invoices',
      tag: 'Collaborations',
      summary: 'Invoices',
      query: z.object({ status: z.string().max(20).optional(), dealId: uuid.optional() }),
    },
    async ({ ctx, query }) => {
      await ensureLiveRates(ctx, ov()).catch(() => undefined);
      return listInvoices(ctx, query);
    },
  );
  route(
    {
      method: 'GET',
      url: '/invoices/:id',
      tag: 'Collaborations',
      summary: 'Invoice with payments',
      params: idParam,
    },
    ({ ctx, params }) => getInvoice(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/invoices',
      tag: 'Collaborations',
      summary: 'Create an invoice (numbered automatically)',
      status: 201,
      body: z.object({
        dealId: uuid.nullable().optional(),
        invoiceNo: z.string().max(40).optional(),
        amountMinor: z.number().int().positive(),
        currency: currency.optional(),
        issuedAt: date.nullable().optional(),
        dueAt: date.nullable().optional(),
        termsDays: z.number().int().min(0).max(365).optional(),
        notes: z.string().max(2000).nullable().optional(),
        draft: z.boolean().optional(),
      }),
    },
    ({ ctx, body }) => createInvoice(ctx, body),
  );
  route(
    {
      method: 'PATCH',
      url: '/invoices/:id',
      tag: 'Collaborations',
      summary: 'Edit an invoice (amount cannot drop below what was received)',
      params: idParam,
      body: z
        .object({
          invoiceNo: z.string().min(1).max(40),
          amountMinor: z.number().int().positive(),
          currency,
          issuedAt: date.nullable(),
          dueAt: date.nullable(),
          notes: z.string().max(2000).nullable(),
          dealId: uuid.nullable(),
        })
        .partial(),
    },
    ({ ctx, params, body }) => updateInvoice(ctx, params.id, body),
  );
  route(
    {
      method: 'DELETE',
      url: '/invoices/:id',
      tag: 'Collaborations',
      summary: 'Delete an invoice with no payments (otherwise void it)',
      params: idParam,
    },
    ({ ctx, params }) => deleteInvoice(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/invoices/:id/issue',
      tag: 'Collaborations',
      summary: 'Mark a draft invoice as issued (the app never sends it)',
      params: idParam,
      body: z.object({ dueAt: date.nullable().optional() }),
    },
    ({ ctx, params, body }) => issueInvoice(ctx, params.id, body.dueAt ?? undefined),
  );
  route(
    {
      method: 'POST',
      url: '/invoices/:id/void',
      tag: 'Collaborations',
      summary: 'Void an invoice',
      params: idParam,
    },
    ({ ctx, params }) => voidInvoice(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/invoices/:id/payments',
      tag: 'Collaborations',
      summary: 'Record a payment received (same currency, no overpayment)',
      params: idParam,
      status: 201,
      body: z.object({
        amountMinor: z.number().int().positive(),
        currency: currency.optional(),
        receivedAt: date.optional(),
        method: z.enum(PAYMENT_METHOD).optional(),
        reference: z.string().max(200).nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
        verified: z.boolean().optional(),
      }),
    },
    ({ ctx, params, body }) => recordPayment(ctx, params.id, body),
  );
  route(
    {
      method: 'PUT',
      url: '/fx-rates',
      tag: 'Collaborations',
      summary: 'Set an exchange rate (totals convert only when every currency has a rate)',
      body: z.object({
        base: currency,
        quote: currency,
        rate: z.number().positive(),
        rateDate: date,
        source: z.string().max(100).optional(),
      }),
    },
    ({ ctx, body }) => setFxRate(ctx, body),
  );
  route(
    {
      method: 'GET',
      url: '/finance/summary',
      tag: 'Collaborations',
      summary: 'Received / outstanding / overdue per currency',
      query: z.object({ from: date.optional(), to: date.optional() }),
    },
    async ({ ctx, query }) => {
      await ensureLiveRates(ctx, ov()).catch(() => undefined);
      return financeSummary(ctx, query);
    },
  );

  // ================================================================ today / actions
  route(
    { method: 'GET', url: '/briefing', tag: 'Today', summary: 'Top 3 things to do now, plus counts' },
    ({ ctx }) => briefing(ctx, ctx.now()),
  );
  route(
    {
      method: 'GET',
      url: '/actions',
      tag: 'Today',
      summary: 'Action queue',
      query: z.object({
        state: z.enum(['OPEN', 'SNOOZED', 'DONE', 'DISMISSED']).optional(),
        includeSnoozed: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
        limit: z.coerce.number().int().max(500).optional(),
      }),
    },
    ({ ctx, query }) => listActions(ctx, query),
  );
  route(
    { method: 'GET', url: '/actions/recent', tag: 'Today', summary: 'Recently completed actions' },
    ({ ctx }) => recentCompleted(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/actions',
      tag: 'Today',
      summary: 'Create a manual action',
      status: 201,
      body: z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().max(5000).nullable().optional(),
        dueAt: date.nullable().optional(),
        priority: z.enum(PRIORITY).optional(),
        deepLink: z.string().max(500).nullable().optional(),
        pinned: z.boolean().optional(),
      }),
    },
    ({ ctx, body }) => createAction(ctx, body),
  );
  route(
    {
      method: 'POST',
      url: '/actions/refresh',
      tag: 'Today',
      summary: 'Re-evaluate follow-up rules now',
      status: 200,
    },
    async ({ ctx }) => runActionsEngine(db, ctx.orgId, ctx.now()),
  );
  route(
    {
      method: 'POST',
      url: '/actions/:id/complete',
      tag: 'Today',
      summary: 'Mark done',
      params: idParam,
      body: z.object({ evidence: z.string().max(1000).nullable().optional() }),
    },
    ({ ctx, params, body }) => completeAction(ctx, params.id, body.evidence),
  );
  route(
    { method: 'POST', url: '/actions/:id/dismiss', tag: 'Today', summary: 'Dismiss', params: idParam },
    ({ ctx, params }) => dismissAction(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/actions/:id/snooze',
      tag: 'Today',
      summary: 'Snooze until a time',
      params: idParam,
      body: z.object({ until: date }),
    },
    ({ ctx, params, body }) => snoozeAction(ctx, params.id, body.until),
  );
  route(
    { method: 'POST', url: '/actions/:id/reopen', tag: 'Today', summary: 'Reopen', params: idParam },
    ({ ctx, params }) => reopenAction(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/actions/:id/pin',
      tag: 'Today',
      summary: 'Pin or unpin',
      params: idParam,
      body: z.object({ pinned: z.boolean() }),
    },
    ({ ctx, params, body }) => pinAction(ctx, params.id, body.pinned),
  );

  // ---- Todo PWA link (generic adapter)
  route({ method: 'GET', url: '/todo/status', tag: 'Today', summary: 'Todo integration status' }, ({ ctx }) =>
    todoStatus(ctx),
  );
  route(
    {
      method: 'GET',
      url: '/todo/links',
      tag: 'Today',
      summary: 'Task links and sync state',
      query: z.object({ state: z.string().max(20).optional() }),
    },
    ({ ctx, query }) => listTaskLinks(ctx, query.state),
  );
  route(
    {
      method: 'POST',
      url: '/actions/:id/todo',
      tag: 'Today',
      summary: 'Send this action to Todo (idempotent)',
      params: idParam,
      body: z.object({ remoteTaskId: z.string().max(200).optional() }),
      status: 201,
    },
    ({ ctx, params, body }) => linkActionToTodo(ctx, params.id, body),
  );
  route(
    {
      method: 'POST',
      url: '/todo/links/:id/sync',
      tag: 'Today',
      summary: 'Sync one task link now',
      params: idParam,
    },
    ({ params }) => syncTaskLink(db, env, params.id, ov()),
  );
  route(
    {
      method: 'POST',
      url: '/todo/links/:id/retry',
      tag: 'Today',
      summary: 'Retry a failed/dead-lettered link',
      params: idParam,
    },
    ({ ctx, params }) => retryTaskLink(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/todo/links/:id/resolve',
      tag: 'Today',
      summary: 'Resolve a sync conflict',
      params: idParam,
      body: z.object({ resolution: z.enum(['USE_LOCAL', 'USE_REMOTE']) }),
    },
    ({ ctx, params, body }) => resolveTodoConflict(ctx, params.id, body.resolution, ov()),
  );

  // ================================================================ notifications
  route(
    {
      method: 'GET',
      url: '/notifications',
      tag: 'Today',
      summary: 'Notifications',
      query: z.object({
        unreadOnly: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
        limit: z.coerce.number().int().max(200).optional(),
      }),
    },
    async ({ ctx, query }) =>
      withMeta(await listNotifications(ctx, query), { unread: await unreadCount(ctx) }),
  );
  route(
    {
      method: 'POST',
      url: '/notifications/read',
      tag: 'Today',
      summary: 'Mark notifications read',
      body: z.object({ ids: z.union([z.array(uuid).max(200), z.literal('all')]) }),
    },
    async ({ ctx, body }) => {
      await markRead(ctx, body.ids);
      return { unread: await unreadCount(ctx) };
    },
  );
  route(
    {
      method: 'GET',
      url: '/notification-preferences',
      tag: 'Settings',
      summary: 'Quiet hours, digests, rules',
    },
    ({ ctx }) => getPrefs(ctx),
  );
  route(
    {
      method: 'PATCH',
      url: '/notification-preferences',
      tag: 'Settings',
      summary: 'Update preferences',
      body: z
        .object({
          timezone: z.string().max(64),
          quietStart: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
          quietEnd: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
          inApp: z.boolean(),
          browserPush: z.boolean(),
          digestHour: z.number().int().min(0).max(23),
          rules: z.record(z.string(), z.boolean()),
        })
        .partial(),
    },
    ({ ctx, body }) => updatePrefs(ctx, body),
  );

  // ================================================================ integrations (honest states, nothing fake)
  route(
    {
      method: 'GET',
      url: '/integrations',
      tag: 'Integrations',
      summary: 'Every provider with its real state and capabilities',
      role: 'EDITOR',
    },
    ({ ctx }) => listIntegrations(ctx, ov()),
  );
  route(
    {
      method: 'POST',
      url: '/integrations/:provider/oauth/start',
      tag: 'Integrations',
      summary: 'Begin OAuth (PKCE). Returns the consent URL; nothing is connected until you approve.',
      role: 'OWNER',
      params: z.object({ provider: z.enum(['gmail', 'youtube', 'instagram', 'facebook']) }),
      body: z.object({
        publish: z.boolean().optional(),
        comments: z.boolean().optional(),
        messages: z.boolean().optional(),
        reconnect: z.boolean().optional(),
        drafts: z.boolean().optional(),
        send: z.boolean().optional(),
        analytics: z.boolean().optional(),
        loginHint: z.string().max(254).optional(),
      }),
    },
    ({ ctx, params, body }) => startOAuth(ctx, params.provider, body, ov()),
  );
  // Provider redirects the browser here. State is single-use and hashed in the DB.
  const oauthCallback = async (req: any, reply: any) => {
    const q = z
      .object({
        state: z.string().max(500),
        code: z.string().max(2000).optional(),
        error: z.string().max(200).optional(),
      })
      .parse(req.query);
    try {
      const r: any = await completeOAuth(db, env, q, ov());
      // Only the provider name goes in the URL; tokens never leave the server.
      return reply.redirect(
        `${env.appBaseUrl}/integrations?connected=${encodeURIComponent(r?.provider ?? '')}`,
      );
    } catch (e) {
      const msg = e instanceof AppError ? e.code : 'ERROR';
      const detail = scrubText(String((e as Error)?.message ?? e)).slice(0, 300);
      req.log.warn({ code: msg, detail }, 'oauth callback failed');
      return reply.redirect(
        `${env.appBaseUrl}/integrations?error=${encodeURIComponent(msg)}&detail=${encodeURIComponent(detail)}`,
      );
    }
  };
  const oauthCallbackSchema = { schema: { tags: ['Integrations'], summary: 'OAuth redirect target' } };
  app.get('/integrations/oauth/callback', oauthCallbackSchema, oauthCallback);
  // Instagram Login has its own redirect URI, separate from the Google one and from the webhook.
  app.get('/integrations/meta/instagram/callback', oauthCallbackSchema, oauthCallback);
  app.get('/integrations/meta/facebook/callback', oauthCallbackSchema, oauthCallback);

  // Meta webhooks: separate from OAuth. Handshake echoes hub.challenge; deliveries are HMAC-verified over the raw body.
  app.get(
    '/integrations/meta/instagram/webhook',
    { schema: { tags: ['Integrations'], summary: 'Meta webhook verification handshake' } },
    async (req, reply) => {
      const q = z
        .object({
          'hub.mode': z.string().max(50).optional(),
          'hub.verify_token': z.string().max(500).optional(),
          'hub.challenge': z.string().max(500).optional(),
        })
        .parse(req.query);
      const challenge = verifyMetaHandshake(env, {
        mode: q['hub.mode'],
        verifyToken: q['hub.verify_token'],
        challenge: q['hub.challenge'],
      });
      return reply.type('text/plain').send(challenge);
    },
  );
  app.post(
    '/integrations/meta/instagram/webhook',
    { bodyLimit: 256 * 1024, schema: { tags: ['Integrations'], summary: 'Meta webhook delivery (signed)' } },
    async (req, reply) => {
      const raw = typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody) ? req.rawBody : '';
      try {
        const r = await receiveInstagramWebhook(
          db,
          env,
          raw,
          req.headers['x-hub-signature-256'] as string | undefined,
        );
        req.log.info(
          { received: r.received, stored: r.stored, duplicates: r.duplicates },
          'meta webhook accepted',
        );
        return reply.send({ data: r, meta: {}, error: null });
      } catch (e) {
        // never log the body: it holds message text
        req.log.warn(
          {
            code: (e as any)?.code,
            status: (e as any)?.status,
            bytes: Buffer.byteLength(raw),
            hasSignature: Boolean(req.headers['x-hub-signature-256']),
          },
          'meta webhook rejected',
        );
        throw e;
      }
    },
  );
  // Facebook Page webhooks: same handshake token, but deliveries are signed with the PARENT Meta app secret.
  app.get(
    '/integrations/meta/facebook/webhook',
    { schema: { tags: ['Integrations'], summary: 'Facebook Page webhook verification handshake' } },
    async (req, reply) => {
      const q = z
        .object({
          'hub.mode': z.string().max(50).optional(),
          'hub.verify_token': z.string().max(500).optional(),
          'hub.challenge': z.string().max(500).optional(),
        })
        .parse(req.query);
      const challenge = verifyMetaHandshake(env, {
        mode: q['hub.mode'],
        verifyToken: q['hub.verify_token'],
        challenge: q['hub.challenge'],
      });
      return reply.type('text/plain').send(challenge);
    },
  );
  app.post(
    '/integrations/meta/facebook/webhook',
    {
      bodyLimit: 256 * 1024,
      schema: { tags: ['Integrations'], summary: 'Facebook Page webhook delivery (signed)' },
    },
    async (req, reply) => {
      const raw = typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody) ? req.rawBody : '';
      try {
        const r = await receiveFacebookWebhook(
          db,
          env,
          raw,
          req.headers['x-hub-signature-256'] as string | undefined,
        );
        req.log.info(
          { received: r.received, stored: r.stored, duplicates: r.duplicates },
          'facebook webhook accepted',
        );
        return reply.send({ data: r, meta: {}, error: null });
      } catch (e) {
        req.log.warn(
          {
            code: (e as any)?.code,
            status: (e as any)?.status,
            bytes: Buffer.byteLength(raw),
            hasSignature: Boolean(req.headers['x-hub-signature-256']),
          },
          'facebook webhook rejected',
        );
        throw e;
      }
    },
  );
  route(
    {
      method: 'POST',
      url: '/integrations/:provider/key',
      tag: 'Integrations',
      summary: 'Save an API key / token (encrypted at rest)',
      role: 'OWNER',
      params: z.object({ provider: z.enum(['todo', 'postiz', 'meta', 'tiktok']) }),
      body: z.object({
        label: z.string().max(100).optional(),
        apiKey: z.string().max(4000).optional(),
        accessToken: z.string().max(8000).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    ({ ctx, params, body }) => saveKeyConnection(ctx, params.provider, body),
  );
  route(
    {
      method: 'POST',
      url: '/integrations/:provider/test',
      tag: 'Integrations',
      summary: 'Test the connection',
      role: 'OWNER',
      params: z.object({ provider: z.enum(PROVIDER) }),
      body: z.object({ connectionId: uuid.optional() }).optional(),
    },
    ({ ctx, params, body }) => testConnection(ctx, params.provider, ov(), body?.connectionId),
  );
  route(
    {
      method: 'POST',
      url: '/connections/:id/disconnect',
      tag: 'Integrations',
      summary: 'Disconnect and wipe stored credentials',
      role: 'OWNER',
      params: idParam,
    },
    async ({ ctx, params }) => {
      await disconnect(ctx, params.id, ov());
      return { ok: true };
    },
  );
  route(
    {
      method: 'POST',
      url: '/connections/:id/pause',
      tag: 'Integrations',
      summary: 'Pause or resume syncing',
      role: 'OWNER',
      params: idParam,
      body: z.object({ paused: z.boolean() }),
    },
    async ({ ctx, params, body }) => {
      await setConnectionPaused(ctx, params.id, body.paused);
      return { ok: true };
    },
  );
  route(
    {
      method: 'POST',
      url: '/connections/:id/sync',
      tag: 'Integrations',
      summary: 'Sync now',
      role: 'EDITOR',
      params: idParam,
      body: z.object({ full: z.boolean().optional() }),
    },
    async ({ params, body }) => {
      if (deps.enqueue) {
        await deps.enqueue('sync', 'connection', { connectionId: params.id, full: body.full ?? false });
        return { queued: true };
      }
      return runSync(db, env, params.id, { full: body.full }, ov());
    },
  );
  route(
    {
      method: 'POST',
      url: '/social-accounts/:id/connection',
      tag: 'Integrations',
      summary: 'Link a social account to a connection (needed before imports can attach posts)',
      role: 'OWNER',
      params: idParam,
      body: z.object({ connectionId: uuid.nullable() }),
    },
    async ({ ctx, params, body }) => {
      await linkSocialAccountToConnection(ctx, params.id, body.connectionId);
      return { ok: true };
    },
  );

  // ================================================================ search / analytics / goals
  route(
    {
      method: 'GET',
      url: '/search',
      tag: 'Insights',
      summary: 'Global search across 10 entity types',
      query: z.object({ q: z.string().trim().min(1).max(200) }),
    },
    ({ ctx, query, session }) => search(ctx, query.q, 6, session.role !== 'VIEWER'),
  );
  route(
    {
      method: 'GET',
      url: '/analytics',
      tag: 'Insights',
      summary: 'Counts and top posts with explicit provenance (verified vs manual)',
      query: z.object({
        from: date.optional(),
        to: date.optional(),
        brandId: uuid.optional(),
        socialAccountId: uuid.optional(),
        platform: z.string().max(20).optional(),
      }),
    },
    ({ ctx, query }) => analytics(ctx, query),
  );
  route(
    {
      method: 'POST',
      url: '/analytics/snapshot',
      tag: 'Insights',
      summary: 'Store a snapshot of today’s numbers',
      status: 201,
      role: 'EDITOR',
    },
    ({ ctx }) => snapshotAnalytics(db, ctx.orgId, ctx.now()),
  );
  route(
    {
      method: 'GET',
      url: '/goals',
      tag: 'Insights',
      summary: 'Goals with progress (derived where possible, manual otherwise)',
    },
    ({ ctx }) => listGoals(ctx, ctx.now()),
  );
  const goalBody = z.object({
    name: z.string().trim().min(1).max(200),
    period: z.enum(GOAL_PERIOD).optional(),
    metric: z.enum(GOAL_METRIC).optional(),
    customMetric: z.string().max(100).nullable().optional(),
    targetValue: z.number().positive(),
    unit: z.string().max(20).optional(),
    kind: z.enum(['ACTIVITY', 'OUTCOME']).optional(),
    brandId: uuid.nullable().optional(),
    channelId: uuid.nullable().optional(),
  });
  route(
    { method: 'POST', url: '/goals', tag: 'Insights', summary: 'Create a goal', status: 201, body: goalBody },
    ({ ctx, body }) => createGoal(ctx, body),
  );
  route(
    {
      method: 'PATCH',
      url: '/goals/:id',
      tag: 'Insights',
      summary: 'Edit a goal (target changes are kept in history)',
      params: idParam,
      body: goalBody.partial().extend({ active: z.boolean().optional() }),
    },
    ({ ctx, params, body }) => updateGoal(ctx, params.id, body),
  );
  route(
    {
      method: 'POST',
      url: '/goals/:id/observations',
      tag: 'Insights',
      summary: 'Record an actual value by hand',
      params: idParam,
      status: 201,
      body: z.object({ actual: z.number() }),
    },
    ({ ctx, params, body }) => recordGoalObservation(ctx, params.id, body.actual, 'USER_ENTERED', ctx.now()),
  );

  // ================================================================ backups
  route(
    { method: 'GET', url: '/backups', tag: 'System', summary: 'Backup history', role: 'OWNER' },
    ({ ctx }) => listBackups(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/backups',
      tag: 'System',
      summary: 'Run a backup now (pg_dump + attachments + checksum manifest)',
      role: 'OWNER',
      status: 202,
    },
    async ({ ctx }) => {
      if (deps.enqueue) {
        await deps.enqueue('maintenance', 'backup', { kind: 'manual' });
        return { queued: true };
      }
      return requestBackup(ctx);
    },
  );
  route(
    {
      method: 'POST',
      url: '/backups/restore-test',
      tag: 'System',
      summary:
        'Restore the newest backup into a throw-away database and verify it (live data is never touched)',
      role: 'OWNER',
      status: 202,
    },
    async () => {
      if (!deps.enqueue)
        throw new AppError(503, 'QUEUE_UNAVAILABLE', 'The background worker is not attached to this server.');
      await deps.enqueue('maintenance', 'restore-test', {});
      return { queued: true };
    },
  );
  route(
    {
      method: 'GET',
      url: '/backups/:id',
      tag: 'System',
      summary: 'Backup detail',
      role: 'OWNER',
      params: idParam,
    },
    ({ ctx, params }) => getBackup(ctx, params.id),
  );

  void connectorContext;
  void createBackup;
  void goalProgress;
}
