import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, ts, updatedAt } from './columns';
import { conversationThreads } from './crm';
import { orgRef, providerConnections, users } from './identity';

/**
 * Every outgoing social message. The sending identity (connection + provider account id) is copied from the
 * conversation and re-checked at send time, so a row can never be sent from another account.
 */
export const socialOutboundMessages = pgTable(
  'social_outbound_messages',
  {
    id: pk(),
    orgId: orgRef(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => conversationThreads.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'restrict' }),
    providerAccountId: text('provider_account_id').notNull(),
    recipientId: text('recipient_id').notNull(),
    kind: text('kind').notNull().default('DM'), // DM | COMMENT_REPLY
    body: text('body').notNull(),
    state: text('state').notNull().default('DRAFT'), // DRAFT | SENDING | SENT | FAILED | UNCERTAIN
    requestId: text('request_id').notNull(),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    source: text('source').notNull().default('USER'), // USER | WORKFLOW
    executionId: uuid('execution_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('social_outbound_request_uq').on(t.orgId, t.requestId),
    index('social_outbound_thread_idx').on(t.threadId, t.createdAt),
    index('social_outbound_conn_state_idx').on(t.connectionId, t.state, t.sentAt),
  ],
);

export const workflows = pgTable(
  'workflows',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    description: text('description'),
    mode: text('mode').notNull().default('DRAFT_ONLY'), // DRAFT_ONLY | APPROVAL | AUTOMATIC
    status: text('status').notNull().default('DRAFT'), // DRAFT | ACTIVE | PAUSED
    connectionIds: uuid('connection_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    activeVersionId: uuid('active_version_id'),
    latestVersion: integer('latest_version').notNull().default(1),
    testedAt: ts('tested_at'),
    testedVersion: integer('tested_version'),
    pauseReason: text('pause_reason'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('workflows_org_status_idx').on(t.orgId, t.status)],
);

export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: pk(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    mode: text('mode').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('workflow_versions_uq').on(t.workflowId, t.version)],
);

export const workflowExecutions = pgTable(
  'workflow_executions',
  {
    id: pk(),
    orgId: orgRef(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => workflowVersions.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    // Deduplication: one real execution per workflow per provider event, however often the webhook is redelivered.
    eventKey: text('event_key').notNull(),
    isSimulation: boolean('is_simulation').notNull().default(false),
    connectionId: uuid('connection_id').references(() => providerConnections.id, { onDelete: 'set null' }),
    threadId: uuid('thread_id').references(() => conversationThreads.id, { onDelete: 'set null' }),
    messageId: uuid('message_id'),
    status: text('status').notNull().default('RUNNING'),
    outcome: text('outcome'),
    trace: jsonb('trace').$type<unknown[]>().notNull().default([]),
    error: text('error'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    uniqueIndex('workflow_executions_event_uq')
      .on(t.workflowId, t.eventKey)
      .where(sql`${t.isSimulation} = false`),
    index('workflow_executions_wf_idx').on(t.workflowId, t.startedAt),
    index('workflow_executions_org_status_idx').on(t.orgId, t.status),
  ],
);

export const workflowApprovals = pgTable(
  'workflow_approvals',
  {
    id: pk(),
    orgId: orgRef(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => workflowExecutions.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => conversationThreads.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'restrict' }),
    recipientId: text('recipient_id').notNull(),
    kind: text('kind').notNull().default('DM'),
    proposedText: text('proposed_text').notNull(),
    finalText: text('final_text'),
    reason: text('reason'),
    state: text('state').notNull().default('PENDING'), // PENDING | SENT | REJECTED | SNOOZED | EXPIRED | FAILED
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts('decided_at'),
    snoozedUntil: ts('snoozed_until'),
    outboundId: uuid('outbound_id'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('workflow_approvals_state_idx').on(t.orgId, t.state, t.createdAt),
    // a workflow proposes at most one reply per execution
    uniqueIndex('workflow_approvals_exec_uq').on(t.executionId),
  ],
);
