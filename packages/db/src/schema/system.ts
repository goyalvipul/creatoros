import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, int8, pk, ts, updatedAt } from './columns';
import {
  actionState,
  backupState,
  goalKind,
  goalMetric,
  goalPeriod,
  jobStatus,
  outboxState,
  priority,
  provenance,
  provider,
  severity,
  syncState,
} from './enums';
import {
  brands,
  channels,
  orgRef,
  organizations,
  providerConnections,
  socialAccounts,
  users,
} from './identity';

export const internalActions = pgTable(
  'internal_actions',
  {
    id: pk(),
    orgId: orgRef(),
    sourceType: text('source_type').notNull().default('manual'),
    sourceId: uuid('source_id'),
    ruleKey: text('rule_key'),
    dedupeKey: text('dedupe_key'),
    title: text('title').notNull(),
    description: text('description'),
    reason: text('reason'),
    deepLink: text('deep_link'),
    dueAt: ts('due_at'),
    priority: priority('priority').notNull().default('NORMAL'),
    state: actionState('state').notNull().default('OPEN'),
    snoozedUntil: ts('snoozed_until'),
    dismissedAt: ts('dismissed_at'),
    completedAt: ts('completed_at'),
    completionEvidence: text('completion_evidence'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    pinned: boolean('pinned').notNull().default(false),
    escalationLevel: integer('escalation_level').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('internal_actions_dedupe_uq')
      .on(t.orgId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.state} in ('OPEN','SNOOZED')`),
    index('internal_actions_org_state_due_idx').on(t.orgId, t.state, t.dueAt),
    index('internal_actions_source_idx').on(t.sourceType, t.sourceId),
  ],
);

export const taskIntegrations = pgTable('task_integrations', {
  id: pk(),
  orgId: orgRef(),
  providerConnectionId: uuid('provider_connection_id').references(() => providerConnections.id, {
    onDelete: 'cascade',
  }),
  name: text('name').notNull().default('Todo PWA'),
  baseUrl: text('base_url'),
  syncDirection: text('sync_direction').notNull().default('BOTH'), // PUSH | PULL | BOTH
  conflictPolicy: text('conflict_policy').notNull().default('TODO_OWNS_DUE_AND_COMPLETION'),
  capabilities: jsonb('capabilities').$type<Record<string, boolean>>().notNull().default({}),
  endpointMap: jsonb('endpoint_map').$type<Record<string, string>>().notNull().default({}),
  fieldMap: jsonb('field_map').$type<Record<string, string>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(false),
  lastReconcileAt: ts('last_reconcile_at'),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const taskLinks = pgTable(
  'task_links',
  {
    id: pk(),
    orgId: orgRef(),
    actionId: uuid('action_id')
      .notNull()
      .references(() => internalActions.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => taskIntegrations.id, { onDelete: 'cascade' }),
    remoteTaskId: text('remote_task_id'),
    remoteRevision: text('remote_revision'),
    idempotencyKey: text('idempotency_key').notNull(),
    syncState: syncState('sync_state').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at'),
    lastSyncAt: ts('last_sync_at'),
    lastError: text('last_error'),
    lastLocalHash: text('last_local_hash'),
    remoteDueAt: ts('remote_due_at'),
    remoteCompletedAt: ts('remote_completed_at'),
    conflictData: jsonb('conflict_data').$type<Record<string, unknown>>().notNull().default({}),
    syncLog: jsonb('sync_log')
      .$type<{ at: string; event: string; detail?: string }[]>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('task_links_idem_uq').on(t.idempotencyKey),
    uniqueIndex('task_links_action_integration_uq').on(t.actionId, t.integrationId),
    index('task_links_state_idx').on(t.orgId, t.syncState, t.nextAttemptAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
    type: text('type').notNull(),
    dedupeKey: text('dedupe_key'),
    title: text('title').notNull(),
    body: text('body'),
    severity: severity('severity').notNull().default('INFO'),
    deepLink: text('deep_link'),
    readAt: ts('read_at'),
    snoozedUntil: ts('snoozed_until'),
    deliveredAt: ts('delivered_at'),
    deliveredVia: text('delivered_via')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('notifications_dedupe_uq')
      .on(t.orgId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index('notifications_user_idx').on(t.orgId, t.userId, t.readAt),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('America/Vancouver'),
    quietStart: text('quiet_start').default('22:00'),
    quietEnd: text('quiet_end').default('07:00'),
    inApp: boolean('in_app').notNull().default(true),
    browserPush: boolean('browser_push').notNull().default(false),
    digestHour: integer('digest_hour').notNull().default(8),
    rules: jsonb('rules').$type<Record<string, boolean>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('notification_prefs_uq').on(t.orgId, t.userId)],
);

export const goals = pgTable(
  'goals',
  {
    id: pk(),
    orgId: orgRef(),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    period: goalPeriod('period').notNull().default('MONTH'),
    metric: goalMetric('metric').notNull().default('RELEASES'),
    customMetric: text('custom_metric'),
    targetValue: doublePrecision('target_value').notNull(),
    unit: text('unit').notNull().default('count'),
    kind: goalKind('kind').notNull().default('ACTIVITY'),
    provenance: provenance('provenance').notNull().default('USER_ENTERED'),
    revision: integer('revision').notNull().default(1),
    history: jsonb('history')
      .$type<{ at: string; targetValue: number; revision: number }[]>()
      .notNull()
      .default([]),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('goals_org_idx').on(t.orgId, t.active)],
);

export const goalObservations = pgTable(
  'goal_observations',
  {
    id: pk(),
    orgId: orgRef(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    periodStart: ts('period_start').notNull(),
    actual: doublePrecision('actual').notNull(),
    source: provenance('source').notNull().default('ESTIMATED'),
    snapshotAt: ts('snapshot_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('goal_observations_uq').on(t.goalId, t.periodStart)],
);

export const analyticsSnapshots = pgTable(
  'analytics_snapshots',
  {
    id: pk(),
    orgId: orgRef(),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    socialAccountId: uuid('social_account_id').references(() => socialAccounts.id, { onDelete: 'set null' }),
    period: text('period').notNull().default('DAY'),
    periodStart: ts('period_start').notNull(),
    periodEnd: ts('period_end'),
    timezone: text('timezone').notNull().default('America/Vancouver'),
    metrics: jsonb('metrics').$type<Record<string, number | null>>().notNull().default({}),
    provenance: provenance('provenance').notNull().default('UNKNOWN'),
    source: text('source').notNull().default('computed'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('analytics_snapshots_uq').on(
      t.orgId,
      sql`coalesce(${t.socialAccountId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.period,
      t.periodStart,
      t.source,
    ),
  ],
);

export const backgroundJobs = pgTable(
  'background_jobs',
  {
    id: pk(),
    orgId: uuid('org_id'),
    type: text('type').notNull(),
    queue: text('queue'),
    externalJobId: text('external_job_id'),
    source: text('source'),
    status: jobStatus('status').notNull().default('QUEUED'),
    attempts: integer('attempts').notNull().default(0),
    failReason: text('fail_reason'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<Record<string, unknown>>().notNull().default({}),
    scheduledFor: ts('scheduled_for'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('background_jobs_status_idx').on(t.status, t.createdAt),
    index('background_jobs_type_idx').on(t.type, t.createdAt),
  ],
);

export const syncCursors = pgTable(
  'sync_cursors',
  {
    id: pk(),
    orgId: orgRef(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    cursor: text('cursor'),
    lastSuccessAt: ts('last_success_at'),
    restartRequired: boolean('restart_required').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sync_cursors_uq').on(t.connectionId, t.scope)],
);

export const oauthStates = pgTable(
  'oauth_states',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id'),
    provider: provider('provider').notNull(),
    stateHash: text('state_hash').notNull(),
    codeVerifierEnc: text('code_verifier_enc').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    redirectUri: text('redirect_uri').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('oauth_states_hash_uq').on(t.stateHash)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: pk(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull().default('user'),
    action: text('action').notNull(),
    objectType: text('object_type'),
    objectId: text('object_id'),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    correlationId: text('correlation_id'),
    ip: text('ip'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_org_at_idx').on(t.orgId, t.at),
    index('audit_events_object_idx').on(t.objectType, t.objectId),
  ],
);

export const apiIdempotencyKeys = pgTable(
  'api_idempotency_keys',
  {
    id: pk(),
    orgId: orgRef(),
    actorId: text('actor_id').notNull(),
    key: text('key').notNull(),
    endpoint: text('endpoint').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    response: jsonb('response').$type<unknown>(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_idempotency_uq').on(t.orgId, t.actorId, t.endpoint, t.key)],
);

export const settingsAndFeatureFlags = pgTable(
  'settings_and_feature_flags',
  {
    id: pk(),
    orgId: orgRef(),
    scope: text('scope').notNull().default('org'),
    key: text('key').notNull(),
    value: jsonb('value').$type<unknown>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    lastValidatedAt: ts('last_validated_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('settings_uq').on(t.orgId, t.scope, t.key)],
);

export const backupRuns = pgTable('backup_runs', {
  id: pk(),
  orgId: uuid('org_id'),
  kind: text('kind').notNull().default('manual'),
  state: backupState('state').notNull().default('RUNNING'),
  target: text('target'),
  checksumSha256: text('checksum_sha256'),
  sizeBytes: int8('size_bytes'),
  manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull().default({}),
  restoreTestRef: text('restore_test_ref'),
  error: text('error'),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
});

export const automationRules = pgTable('automation_rules', {
  id: pk(),
  orgId: orgRef(),
  name: text('name').notNull(),
  trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull().default({}),
  frequency: text('frequency').notNull().default('on_event'),
  actions: jsonb('actions').$type<Record<string, unknown>[]>().notNull().default([]),
  /** Safe execution policy: automations may only create actions/notifications, never send/post/pay. */
  safeOnly: boolean('safe_only').notNull().default(true),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: ts('last_run_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: pk(),
    orgId: orgRef(),
    type: text('type').notNull(),
    version: integer('version').notNull().default(1),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    state: outboxState('state').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    deliveredAt: ts('delivered_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [index('outbox_state_idx').on(t.state, t.nextAttemptAt)],
);

export const webhookReceipts = pgTable(
  'webhook_receipts',
  {
    id: pk(),
    source: text('source').notNull(),
    eventId: text('event_id').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('webhook_receipts_uq').on(t.source, t.eventId)],
);
