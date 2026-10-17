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
  connectorContext,
  convertOpportunityToDeal,
  createAction,
  createBackup,
  createDeal,
  createGoal,
  createInvoice,
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
      }),
    },
    ({ ctx, query }) => listThreads(ctx, query),
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
    ({ ctx, query }) => listInvoices(ctx, query),
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
    ({ ctx, query }) => financeSummary(ctx, query),
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
      params: z.object({ provider: z.enum(['gmail', 'youtube']) }),
      body: z.object({
        drafts: z.boolean().optional(),
        analytics: z.boolean().optional(),
        loginHint: z.string().max(254).optional(),
      }),
    },
    ({ ctx, params, body }) => startOAuth(ctx, params.provider, body, ov()),
  );
  // Provider redirects the browser here. State is single-use and hashed in the DB.
  app.get(
    '/integrations/oauth/callback',
    { schema: { tags: ['Integrations'], summary: 'OAuth redirect target' } },
    async (req, reply) => {
      const q = z
        .object({
          state: z.string().max(500),
          code: z.string().max(2000).optional(),
          error: z.string().max(200).optional(),
        })
        .parse(req.query);
      try {
        const r: any = await completeOAuth(db, env, q, ov());
        return reply.redirect(
          `${env.appBaseUrl}/integrations?connected=${encodeURIComponent(r?.provider ?? '')}`,
        );
      } catch (e) {
        const msg = e instanceof AppError ? e.code : 'ERROR';
        return reply.redirect(`${env.appBaseUrl}/integrations?error=${encodeURIComponent(msg)}`);
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
    },
    ({ ctx, params }) => testConnection(ctx, params.provider, ov()),
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
