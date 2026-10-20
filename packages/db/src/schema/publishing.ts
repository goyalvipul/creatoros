import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import { privacy, provenance, provider, publicationState, scheduleStatus, variantType } from './enums';
import { brands, channels, orgRef, socialAccounts, users } from './identity';
import { assetVersions, fileInstances, logicalAssets } from './storage';
import { creativeProjects } from './production';
import { dealDeliverables } from './crm';

export const distributionVariants = pgTable(
  'distribution_variants',
  {
    id: pk(),
    orgId: orgRef(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => logicalAssets.id, { onDelete: 'cascade' }),
    assetVersionId: uuid('asset_version_id').references(() => assetVersions.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => creativeProjects.id, { onDelete: 'set null' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    format: variantType('format').notNull().default('MASTER'),
    titleMaster: text('title_master').notNull(),
    captionMaster: text('caption_master'),
    hashtags: text('hashtags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    language: text('language').notNull().default('en'),
    cta: text('cta'),
    thumbnailAssetId: uuid('thumbnail_asset_id').references(() => logicalAssets.id, { onDelete: 'set null' }),
    isSponsored: boolean('is_sponsored').notNull().default(false),
    readiness: text('readiness').notNull().default('DRAFT'), // DRAFT | READY | APPROVED
    targetMeta: jsonb('target_meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('distribution_variants_asset_idx').on(t.assetId),
    index('distribution_variants_brand_idx').on(t.brandId),
    index('distribution_variants_org_ready_idx').on(t.orgId, t.readiness),
  ],
);

export const publicationTargets = pgTable(
  'publication_targets',
  {
    id: pk(),
    orgId: orgRef(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => distributionVariants.id, { onDelete: 'cascade' }),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id),
    desired: boolean('desired').notNull().default(true),
    desiredAt: ts('desired_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('publication_targets_uq').on(t.variantId, t.socialAccountId),
    index('publication_targets_account_idx').on(t.socialAccountId),
  ],
);

export const publicationRecords = pgTable(
  'publication_records',
  {
    id: pk(),
    orgId: orgRef(),
    targetId: uuid('target_id').references(() => publicationTargets.id, { onDelete: 'set null' }),
    variantId: uuid('variant_id').references(() => distributionVariants.id, { onDelete: 'set null' }),
    assetVersionId: uuid('asset_version_id').references(() => assetVersions.id, { onDelete: 'set null' }),
    fileInstanceId: uuid('file_instance_id').references(() => fileInstances.id, { onDelete: 'set null' }),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id),
    provider: provider('provider').notNull().default('manual'),
    externalPostId: text('external_post_id'),
    canonicalUrl: text('canonical_url'),
    title: text('title'),
    caption: text('caption'),
    hashtags: text('hashtags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    taggedProducts: text('tagged_products')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    privacy: privacy('privacy').notNull().default('PUBLIC'),
    language: text('language'),
    cta: text('cta'),
    accessibilityCaptions: text('accessibility_captions'),
    thumbnailAssetId: uuid('thumbnail_asset_id').references(() => logicalAssets.id, { onDelete: 'set null' }),
    isSponsored: boolean('is_sponsored').notNull().default(false),
    sponsorDisclosure: boolean('sponsor_disclosure').notNull().default(false),
    deliverableId: uuid('deliverable_id').references((): AnyPgColumn => dealDeliverables.id, {
      onDelete: 'set null',
    }),
    state: publicationState('state').notNull().default('PLANNED'),
    stateProvenance: provenance('state_provenance').notNull().default('USER_ENTERED'),
    stateEvidence: text('state_evidence'),
    plannedAt: ts('planned_at'),
    plannedTimezone: text('planned_timezone').notNull().default('America/Vancouver'),
    publishedAt: ts('published_at'),
    lastSyncedAt: ts('last_synced_at'),
    failureReason: text('failure_reason'),
    retryCount: integer('retry_count').notNull().default(0),
    approvalRequired: boolean('approval_required').notNull().default(false),
    approvedAt: ts('approved_at'),
    unmatchedImport: boolean('unmatched_import').notNull().default(false),
    attribution: jsonb('attribution').$type<Record<string, unknown>>().notNull().default({}),
    latestStats: jsonb('latest_stats').$type<Record<string, unknown>>().notNull().default({}),
    providerMeta: jsonb('provider_meta').$type<Record<string, unknown>>().notNull().default({}),
    isDemo: boolean('is_demo').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('publication_records_external_uq')
      .on(t.orgId, t.socialAccountId, t.externalPostId)
      .where(sql`${t.externalPostId} is not null`),
    index('publication_records_org_state_idx').on(t.orgId, t.state),
    index('publication_records_planned_idx').on(t.orgId, t.plannedAt),
    index('publication_records_variant_idx').on(t.variantId),
    index('publication_records_account_idx').on(t.socialAccountId),
    index('publication_records_file_idx').on(t.fileInstanceId),
  ],
);

/** Videos the owner attached to a title. Removing a row does not delete the file or a post that already went out. */
export const publishItems = pgTable(
  'publish_items',
  {
    id: pk(),
    orgId: orgRef(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => distributionVariants.id, { onDelete: 'cascade' }),
    fileInstanceId: uuid('file_instance_id')
      .notNull()
      .references(() => fileInstances.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('publish_items_uq').on(t.variantId, t.fileInstanceId),
    index('publish_items_org_idx').on(t.orgId),
  ],
);

/** Per-file, per-account caption and the upload job. One row; a second Publish does not upload again. */
export const publishDrafts = pgTable(
  'publish_drafts',
  {
    id: pk(),
    orgId: orgRef(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => publishItems.id, { onDelete: 'cascade' }),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id),
    title: text('title'),
    caption: text('caption'),
    hashtags: text('hashtags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    privacy: text('privacy'),
    requestId: text('request_id'),
    uploadState: text('upload_state').notNull().default('DRAFT'),
    publicationId: uuid('publication_id').references(() => publicationRecords.id, { onDelete: 'set null' }),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('publish_drafts_item_account_uq').on(t.itemId, t.socialAccountId),
    uniqueIndex('publish_drafts_request_uq').on(t.orgId, t.requestId).where(sql`${t.requestId} is not null`),
    index('publish_drafts_state_idx').on(t.orgId, t.uploadState),
  ],
);

export const publicationStatusEvents = pgTable(
  'publication_status_events',
  {
    id: pk(),
    orgId: orgRef(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publicationRecords.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    fromState: publicationState('from_state'),
    toState: publicationState('to_state'),
    source: text('source').notNull().default('user'),
    provenance: provenance('provenance').notNull().default('USER_ENTERED'),
    evidence: text('evidence'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('publication_status_events_pub_idx').on(t.publicationId, t.at)],
);

export const publicationMetricsSnapshots = pgTable(
  'publication_metrics_snapshots',
  {
    id: pk(),
    orgId: orgRef(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publicationRecords.id, { onDelete: 'cascade' }),
    snapshotAt: ts('snapshot_at').notNull().defaultNow(),
    timezone: text('timezone').notNull().default('America/Vancouver'),
    views: int8('views'),
    watchTimeSeconds: int8('watch_time_seconds'),
    impressions: int8('impressions'),
    likes: int8('likes'),
    comments: int8('comments'),
    shares: int8('shares'),
    saves: int8('saves'),
    followersGained: int8('followers_gained'),
    avgViewPct: doublePrecision('avg_view_pct'),
    provenance: provenance('provenance').notNull().default('UNKNOWN'),
    providerMeta: jsonb('provider_meta').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex('publication_metrics_uq').on(t.publicationId, t.snapshotAt)],
);

export const publishingSchedules = pgTable(
  'publishing_schedules',
  {
    id: pk(),
    orgId: orgRef(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publicationRecords.id, { onDelete: 'cascade' }),
    plannedAt: ts('planned_at').notNull(),
    timezone: text('timezone').notNull().default('America/Vancouver'),
    status: scheduleStatus('status').notNull().default('PENDING'),
    connectorJobId: text('connector_job_id'),
    attempts: integer('attempts').notNull().default(0),
    lastResult: jsonb('last_result').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('publishing_schedules_planned_idx').on(t.orgId, t.plannedAt),
    index('publishing_schedules_pub_idx').on(t.publicationId),
  ],
);
