import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WORKFLOW_MODE, WORKFLOW_TEMPLATES } from '@creatoros/domain';
import {
  activateWorkflow,
  approveApproval,
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  exportWorkflow,
  getExecution,
  getSocialThread,
  getWorkflow,
  importWorkflow,
  listApprovals,
  listExecutions,
  listSocialAccounts,
  listSocialThreads,
  listWorkflows,
  markThreadRead,
  pauseWorkflow,
  rejectApproval,
  replyToThread,
  rollbackWorkflow,
  sendingPaused,
  setPauseAllSending,
  simulateWorkflow,
  snoozeApproval,
  syncSocialConversations,
  updateAccountSettings,
  updateWorkflow,
  workflowOverview,
} from '@creatoros/services';
import { idParam, makeRouter, type AppDeps } from '../http';

const uuid = z.uuid();
const csv = z
  .string()
  .max(1000)
  .optional()
  .transform((v) => (v ? v.split(',').filter(Boolean) : undefined));

export function socialsRoutes(app: FastifyInstance, deps: AppDeps) {
  const route = makeRouter(app, deps);
  const ov = () => deps.overrides ?? {};

  // ================================================================ accounts
  route(
    {
      method: 'GET',
      url: '/socials/accounts',
      tag: 'Socials',
      summary: 'Connected social accounts with identity, capabilities and counts',
      role: 'EDITOR',
    },
    ({ ctx }) => listSocialAccounts(ctx),
  );
  route(
    {
      method: 'PATCH',
      url: '/socials/accounts/:id/settings',
      tag: 'Socials',
      summary: 'Per-account automation and reply preferences (automatic sending is off by default)',
      role: 'OWNER',
      params: idParam,
      body: z
        .object({
          autoSendEnabled: z.boolean(),
          dailySendCap: z.number().int().min(0).max(1000),
          perContactCooldownHours: z.number().int().min(0).max(720),
          nickname: z.string().max(60).nullable(),
          signature: z.string().max(200).nullable(),
          defaultLanguage: z.string().max(20).nullable(),
          tone: z.string().max(200).nullable(),
          savedReplies: z
            .array(
              z.object({ id: z.string().max(40), title: z.string().max(80), text: z.string().max(1000) }),
            )
            .max(50),
        })
        .partial(),
    },
    ({ ctx, params, body }) => updateAccountSettings(ctx, params.id, body),
  );
  route(
    {
      method: 'POST',
      url: '/socials/accounts/:id/sync',
      tag: 'Socials',
      summary: 'Backfill recent conversations (historical: never triggers automation)',
      role: 'EDITOR',
      params: idParam,
    },
    ({ ctx, params }) => syncSocialConversations(ctx, params.id, ov()),
  );

  // ================================================================ inbox
  route(
    {
      method: 'GET',
      url: '/socials/threads',
      tag: 'Socials',
      summary: 'Unified inbox conversations',
      role: 'EDITOR',
      query: z.object({
        accounts: csv,
        platform: z.enum(['INSTAGRAM', 'FACEBOOK', 'TIKTOK']).optional(),
        state: z.enum(['NEED_REPLY', 'WAITING_FOR_BRAND', 'WAITING_FOR_USER', 'DONE']).optional(),
        kind: z.enum(['DM', 'COMMENT']).optional(),
        q: z.string().max(200).optional(),
        leads: z.enum(['true', 'false']).optional(),
      }),
    },
    ({ ctx, query }) => {
      const ids = (query.accounts ?? []).filter((i) => uuid.safeParse(i).success);
      return listSocialThreads(ctx, {
        connectionIds: ids,
        platform: query.platform,
        state: query.state,
        kind: query.kind,
        q: query.q,
        leads: query.leads === 'true',
      });
    },
  );
  route(
    {
      method: 'GET',
      url: '/socials/threads/:id',
      tag: 'Socials',
      summary: 'Conversation with its locked sending identity',
      role: 'EDITOR',
      params: idParam,
    },
    ({ ctx, params }) => getSocialThread(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/socials/threads/:id/read',
      tag: 'Socials',
      summary: 'Mark a conversation read',
      params: idParam,
    },
    ({ ctx, params }) => markThreadRead(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/socials/threads/:id/reply',
      tag: 'Socials',
      summary: 'Save a draft or send a reply. The sender is always the account that owns the conversation.',
      params: idParam,
      status: 201,
      body: z.object({
        connectionId: uuid,
        text: z.string().min(1).max(1000),
        requestId: z.string().min(8).max(100),
        send: z.boolean().default(false),
      }),
    },
    ({ ctx, params, body }) => replyToThread(ctx, params.id, body, ov()),
  );

  // ================================================================ workflows
  const definition = z.record(z.string(), z.unknown());
  route(
    { method: 'GET', url: '/workflows', tag: 'Workflows', summary: 'Workflows', role: 'EDITOR' },
    ({ ctx }) => listWorkflows(ctx),
  );
  route(
    {
      method: 'GET',
      url: '/workflows/overview',
      tag: 'Workflows',
      summary: 'Real workflow metrics and the emergency stop state',
      role: 'EDITOR',
    },
    ({ ctx }) => workflowOverview(ctx),
  );
  route(
    {
      method: 'GET',
      url: '/workflows/templates',
      tag: 'Workflows',
      summary: 'Starter templates (importing never activates anything)',
      role: 'EDITOR',
    },
    () => WORKFLOW_TEMPLATES,
  );
  route(
    {
      method: 'GET',
      url: '/workflows/settings',
      tag: 'Workflows',
      summary: 'Workflow settings',
      role: 'EDITOR',
    },
    async ({ ctx }) => ({ pauseAllSending: await sendingPaused(ctx.db, ctx.orgId) }),
  );
  route(
    {
      method: 'PUT',
      url: '/workflows/settings/pause-all',
      tag: 'Workflows',
      summary: 'Emergency stop for ALL automatic sending',
      role: 'OWNER',
      body: z.object({ paused: z.boolean() }),
    },
    ({ ctx, body }) => setPauseAllSending(ctx, body.paused),
  );
  route(
    {
      method: 'POST',
      url: '/workflows',
      tag: 'Workflows',
      summary: 'Create a workflow (always starts as an inactive draft)',
      status: 201,
      body: z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).nullable().optional(),
        mode: z.enum(WORKFLOW_MODE),
        connectionIds: z.array(uuid).max(50),
        definition,
      }),
    },
    ({ ctx, body }) => createWorkflow(ctx, body),
  );
  route(
    {
      method: 'POST',
      url: '/workflows/import',
      tag: 'Workflows',
      summary: 'Import an exported workflow as an inactive draft with no accounts',
      status: 201,
      body: z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).nullable().optional(),
        mode: z.enum(WORKFLOW_MODE),
        definition,
      }),
    },
    ({ ctx, body }) => importWorkflow(ctx, body),
  );
  route(
    {
      method: 'GET',
      url: '/workflows/executions',
      tag: 'Workflows',
      summary: 'Execution history',
      role: 'EDITOR',
      query: z.object({ workflowId: uuid.optional(), status: z.string().max(30).optional() }),
    },
    ({ ctx, query }) => listExecutions(ctx, query),
  );
  route(
    {
      method: 'GET',
      url: '/workflows/executions/:id',
      tag: 'Workflows',
      summary: 'Execution with node-by-node trace',
      role: 'EDITOR',
      params: idParam,
    },
    ({ ctx, params }) => getExecution(ctx, params.id),
  );
  route(
    {
      method: 'GET',
      url: '/workflows/approvals',
      tag: 'Workflows',
      summary: 'Approval queue',
      role: 'EDITOR',
      query: z.object({
        state: z.enum(['PENDING', 'SNOOZED', 'SENT', 'REJECTED', 'EXPIRED', 'FAILED']).optional(),
      }),
    },
    ({ ctx, query }) => listApprovals(ctx, query.state),
  );
  route(
    {
      method: 'POST',
      url: '/workflows/approvals/:id/approve',
      tag: 'Workflows',
      summary: 'Approve (optionally edit) and send, after fresh eligibility checks',
      params: idParam,
      body: z.object({ finalText: z.string().min(1).max(1000).optional() }),
    },
    ({ ctx, params, body }) => approveApproval(ctx, params.id, body, ov()),
  );
  route(
    {
      method: 'POST',
      url: '/workflows/approvals/:id/reject',
      tag: 'Workflows',
      summary: 'Reject: never sends',
      params: idParam,
    },
    ({ ctx, params }) => rejectApproval(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/workflows/approvals/:id/snooze',
      tag: 'Workflows',
      summary: 'Snooze',
      params: idParam,
      body: z.object({ hours: z.number().min(1).max(168) }),
    },
    ({ ctx, params, body }) => snoozeApproval(ctx, params.id, body.hours),
  );
  route(
    {
      method: 'GET',
      url: '/workflows/:id',
      tag: 'Workflows',
      summary: 'Workflow with versions',
      role: 'EDITOR',
      params: idParam,
    },
    ({ ctx, params }) => getWorkflow(ctx, params.id),
  );
  route(
    {
      method: 'GET',
      url: '/workflows/:id/export',
      tag: 'Workflows',
      summary: 'Export (no accounts included)',
      role: 'EDITOR',
      params: idParam,
    },
    ({ ctx, params }) => exportWorkflow(ctx, params.id),
  );
  route(
    {
      method: 'PATCH',
      url: '/workflows/:id',
      tag: 'Workflows',
      summary: 'Edit (creates a new version; the published version keeps running until you activate)',
      params: idParam,
      body: z
        .object({
          name: z.string().min(1).max(120),
          description: z.string().max(500).nullable(),
          mode: z.enum(WORKFLOW_MODE),
          connectionIds: z.array(uuid).max(50),
          definition,
          note: z.string().max(200),
        })
        .partial(),
    },
    ({ ctx, params, body }) => updateWorkflow(ctx, params.id, body),
  );
  route(
    {
      method: 'DELETE',
      url: '/workflows/:id',
      tag: 'Workflows',
      summary: 'Delete (archive)',
      role: 'OWNER',
      params: idParam,
    },
    ({ ctx, params }) => deleteWorkflow(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/workflows/:id/activate',
      tag: 'Workflows',
      summary: 'Publish the latest version and activate',
      role: 'OWNER',
      params: idParam,
    },
    ({ ctx, params }) => activateWorkflow(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/workflows/:id/pause',
      tag: 'Workflows',
      summary: 'Pause (pending approvals are kept)',
      role: 'EDITOR',
      params: idParam,
    },
    ({ ctx, params }) => pauseWorkflow(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/workflows/:id/duplicate',
      tag: 'Workflows',
      summary: 'Duplicate as an inactive draft with no accounts',
      params: idParam,
      status: 201,
    },
    ({ ctx, params }) => duplicateWorkflow(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/workflows/:id/rollback',
      tag: 'Workflows',
      summary: 'Roll back by creating a new version from an old one',
      params: idParam,
      body: z.object({ version: z.number().int().min(1) }),
    },
    ({ ctx, params, body }) => rollbackWorkflow(ctx, params.id, body.version),
  );
  route(
    {
      method: 'POST',
      url: '/workflows/:id/simulate',
      tag: 'Workflows',
      summary:
        'Dry run: never sends or changes anything. Use a real conversation or a synthetic test message.',
      params: idParam,
      body: z.object({
        threadId: uuid.optional(),
        connectionId: uuid.optional(),
        text: z.string().max(2000).optional(),
        senderId: z.string().max(100).optional(),
        senderName: z.string().max(100).optional(),
        kind: z.enum(['DM', 'COMMENT']).optional(),
        hasMedia: z.boolean().optional(),
        isNewConversation: z.boolean().optional(),
        at: z.coerce.date().optional(),
      }),
    },
    ({ ctx, params, body }) => simulateWorkflow(ctx, params.id, body),
  );
}
