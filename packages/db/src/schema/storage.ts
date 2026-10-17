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
import {
  accessMethod,
  approvalState,
  assetKind,
  creativeState,
  deviceState,
  duplicateMethod,
  duplicateState,
  fileAvailability,
  fileKind,
  hashMode,
  previewStatus,
  probeState,
  rootState,
  scanJobType,
  scanStatus,
  variantType,
  verificationState,
} from './enums';
import { brands, orgRef, users } from './identity';
import { creativeProjects } from './production';

export const devices = pgTable(
  'devices',
  {
    id: pk(),
    orgId: orgRef(),
    deviceUuid: uuid('device_uuid').notNull(),
    displayName: text('display_name').notNull(),
    hostname: text('hostname'),
    os: text('os'),
    hardwareLabel: text('hardware_label'),
    agentVersion: text('agent_version'),
    lastSeenAt: ts('last_seen_at'),
    state: deviceState('state').notNull().default('PENDING'),
    tailscaleHint: text('tailscale_hint'),
    listenUrls: text('listen_urls')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    signingKeyEnc: text('signing_key_enc'),
    lastError: text('last_error'),
    load: jsonb('load').$type<Record<string, unknown>>().notNull().default({}),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('devices_org_uuid_uq').on(t.orgId, t.deviceUuid)],
);

export const deviceCredentials = pgTable(
  'device_credentials',
  {
    id: pk(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    pairingAudit: jsonb('pairing_audit').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    uniqueIndex('device_credentials_token_uq').on(t.tokenHash),
    index('device_credentials_device_idx').on(t.deviceId),
  ],
);

export const devicePairingCodes = pgTable(
  'device_pairing_codes',
  {
    id: pk(),
    orgId: orgRef(),
    codeHash: text('code_hash').notNull(),
    label: text('label'),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    usedByDeviceId: uuid('used_by_device_id').references(() => devices.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pairing_codes_hash_uq').on(t.codeHash)],
);

export const physicalShares = pgTable('physical_shares', {
  id: pk(),
  orgId: orgRef(),
  name: text('name').notNull(),
  host: text('host'),
  shareName: text('share_name'),
  uncPath: text('unc_path'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const storageRoots = pgTable(
  'storage_roots',
  {
    id: pk(),
    orgId: orgRef(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    physicalShareId: uuid('physical_share_id').references(() => physicalShares.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    displayPath: text('display_path').notNull(),
    canonicalPath: text('canonical_path').notNull(),
    pathOs: text('path_os').notNull().default('windows'),
    smbPath: text('smb_path'),
    mountPath: text('mount_path'),
    accessMethod: accessMethod('access_method').notNull().default('LOCAL'),
    recursive: boolean('recursive').notNull().default(true),
    includeGlobs: text('include_globs')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    excludeGlobs: text('exclude_globs')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    extensions: text('extensions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    scanIntervalMinutes: integer('scan_interval_minutes').notNull().default(360),
    settleSeconds: integer('settle_seconds').notNull().default(60),
    hashMode: hashMode('hash_mode').notNull().default('all'),
    followLinks: boolean('follow_links').notNull().default(false),
    readOnly: boolean('read_only').notNull().default(true),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references((): AnyPgColumn => creativeProjects.id, {
      onDelete: 'set null',
    }),
    autoTagRules: jsonb('auto_tag_rules')
      .$type<{ pattern: string; tags?: string[]; brandId?: string; projectId?: string }[]>()
      .notNull()
      .default([]),
    state: rootState('state').notNull().default('ACTIVE'),
    scanRequestedAt: ts('scan_requested_at'),
    reconcileRequestedAt: ts('reconcile_requested_at'),
    lastScanAt: ts('last_scan_at'),
    lastSuccessfulScanAt: ts('last_successful_scan_at'),
    lastHeartbeatAt: ts('last_heartbeat_at'),
    consecutiveCompleteScans: integer('consecutive_complete_scans').notNull().default(0),
    health: jsonb('health').$type<Record<string, unknown>>().notNull().default({}),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    retiredAt: ts('retired_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('storage_roots_device_path_uq')
      .on(t.deviceId, t.canonicalPath)
      .where(sql`${t.state} <> 'RETIRED'`),
    index('storage_roots_org_idx').on(t.orgId),
  ],
);

export const scanRuns = pgTable(
  'scan_runs',
  {
    id: pk(),
    orgId: orgRef(),
    rootId: uuid('root_id')
      .notNull()
      .references(() => storageRoots.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(),
    jobType: scanJobType('job_type').notNull().default('SCAN'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    status: scanStatus('status').notNull().default('RUNNING'),
    scannedCount: integer('scanned_count').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),
    changedCount: integer('changed_count').notNull().default(0),
    missingCount: integer('missing_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    completeSuccess: boolean('complete_success').notNull().default(false),
    errors: jsonb('errors').$type<{ path: string; error: string }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('scan_runs_run_uq').on(t.runId), index('scan_runs_root_idx').on(t.rootId, t.startedAt)],
);

export const scanObservations = pgTable(
  'scan_observations',
  {
    id: pk(),
    orgId: orgRef(),
    rootId: uuid('root_id')
      .notNull()
      .references(() => storageRoots.id, { onDelete: 'cascade' }),
    agentEventId: text('agent_event_id').notNull(),
    sequence: int8('sequence').notNull(),
    kind: text('kind').notNull(),
    path: text('path').notNull(),
    fileIdentity: text('file_identity'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    result: text('result').notNull().default('APPLIED'),
  },
  (t) => [
    uniqueIndex('scan_observations_event_uq').on(t.rootId, t.agentEventId),
    index('scan_observations_received_idx').on(t.receivedAt),
  ],
);

export const mediaObjects = pgTable(
  'media_objects',
  {
    id: pk(),
    orgId: orgRef(),
    exactHash: text('exact_hash').notNull(),
    hashAlg: text('hash_alg').notNull().default('sha256'),
    size: int8('size').notNull(),
    mime: text('mime'),
    kind: fileKind('kind').notNull().default('OTHER'),
    tech: jsonb('tech').$type<Record<string, unknown>>().notNull().default({}),
    verificationState: verificationState('verification_state').notNull().default('VERIFIED'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('media_objects_hash_uq')
      .on(t.orgId, t.hashAlg, t.exactHash, t.size)
      .where(sql`${t.verificationState} = 'VERIFIED'`),
  ],
);

export const fileInstances = pgTable(
  'file_instances',
  {
    id: pk(),
    orgId: orgRef(),
    rootId: uuid('root_id')
      .notNull()
      .references(() => storageRoots.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    canonicalPath: text('canonical_path').notNull(),
    displayPath: text('display_path').notNull(),
    fileName: text('file_name').notNull(),
    ext: text('ext').notNull().default(''),
    fileId: text('file_id'),
    size: int8('size').notNull().default(0),
    mtime: ts('mtime'),
    ctime: ts('ctime'),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    lastSeenRunId: uuid('last_seen_run_id'),
    availability: fileAvailability('availability').notNull().default('AVAILABLE'),
    missingSince: ts('missing_since'),
    missingChecks: integer('missing_checks').notNull().default(0),
    quickSignature: text('quick_signature'),
    fullHash: text('full_hash'),
    hashAlg: text('hash_alg'),
    mediaObjectId: uuid('media_object_id').references(() => mediaObjects.id, { onDelete: 'set null' }),
    fileType: fileKind('file_type').notNull().default('OTHER'),
    mime: text('mime'),
    probeState: probeState('probe_state').notNull().default('PENDING'),
    tech: jsonb('tech').$type<Record<string, unknown>>().notNull().default({}),
    stableObservations: integer('stable_observations').notNull().default(0),
    previousInstanceId: uuid('previous_instance_id').references((): AnyPgColumn => fileInstances.id, {
      onDelete: 'set null',
    }),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('file_instances_root_path_uq')
      .on(t.rootId, t.canonicalPath)
      .where(sql`${t.archivedAt} is null`),
    index('file_instances_org_hash_idx').on(t.orgId, t.fullHash),
    index('file_instances_org_sig_idx').on(t.orgId, t.size, t.quickSignature),
    index('file_instances_device_idx').on(t.deviceId),
    index('file_instances_org_type_idx').on(t.orgId, t.fileType),
    index('file_instances_media_idx').on(t.mediaObjectId),
    index('file_instances_root_seen_idx').on(t.rootId, t.lastSeenAt),
    index('file_instances_file_id_idx').on(t.rootId, t.fileId),
    index('file_instances_org_name_idx').on(t.orgId, t.fileName),
  ],
);

export const logicalAssets = pgTable(
  'logical_assets',
  {
    id: pk(),
    orgId: orgRef(),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references((): AnyPgColumn => creativeProjects.id, {
      onDelete: 'set null',
    }),
    kind: assetKind('kind').notNull().default('VIDEO'),
    title: text('title').notNull(),
    description: text('description'),
    creativeState: creativeState('creative_state').notNull().default('DRAFT'),
    selectedVersionId: uuid('selected_version_id').references((): AnyPgColumn => assetVersions.id, {
      onDelete: 'set null',
    }),
    source: text('source').notNull().default('manual'),
    isArchived: boolean('is_archived').notNull().default(false),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('logical_assets_org_kind_idx').on(t.orgId, t.kind),
    index('logical_assets_project_idx').on(t.projectId),
    index('logical_assets_brand_idx').on(t.brandId),
  ],
);

export const assetVersions = pgTable(
  'asset_versions',
  {
    id: pk(),
    orgId: orgRef(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => logicalAssets.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default('v1'),
    number: integer('number').notNull().default(1),
    mediaObjectId: uuid('media_object_id').references(() => mediaObjects.id, { onDelete: 'set null' }),
    variantType: variantType('variant_type').notNull().default('MASTER'),
    approvalState: approvalState('approval_state').notNull().default('PENDING'),
    parentVersionId: uuid('parent_version_id').references((): AnyPgColumn => assetVersions.id, {
      onDelete: 'set null',
    }),
    resolution: text('resolution'),
    intendedUse: text('intended_use'),
    notes: text('notes'),
    isMaster: boolean('is_master').notNull().default(false),
    isFavorite: boolean('is_favorite').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('asset_versions_number_uq').on(t.assetId, t.number),
    index('asset_versions_media_idx').on(t.mediaObjectId),
  ],
);

export const assetFileLinks = pgTable(
  'asset_file_links',
  {
    id: pk(),
    orgId: orgRef(),
    assetVersionId: uuid('asset_version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),
    fileInstanceId: uuid('file_instance_id')
      .notNull()
      .references(() => fileInstances.id, { onDelete: 'cascade' }),
    linkReason: text('link_reason').notNull().default('manual'),
    confidence: doublePrecision('confidence'),
    confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    primaryPreference: boolean('primary_preference').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('asset_file_links_pair_uq').on(t.assetVersionId, t.fileInstanceId),
    index('asset_file_links_file_idx').on(t.fileInstanceId),
  ],
);

export const derivedPreviews = pgTable(
  'derived_previews',
  {
    id: pk(),
    orgId: orgRef(),
    fileInstanceId: uuid('file_instance_id').references(() => fileInstances.id, { onDelete: 'cascade' }),
    mediaObjectId: uuid('media_object_id').references(() => mediaObjects.id, { onDelete: 'cascade' }),
    variantKey: text('variant_key').notNull().default('thumb'),
    relativeCachePath: text('relative_cache_path').notNull(),
    contentType: text('content_type').notNull().default('image/jpeg'),
    sizeBytes: int8('size_bytes').notNull().default(0),
    status: previewStatus('status').notNull().default('READY'),
    generatedAt: ts('generated_at').notNull().defaultNow(),
    lastAccessedAt: ts('last_accessed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('derived_previews_instance_variant_uq').on(t.fileInstanceId, t.variantKey),
    index('derived_previews_media_idx').on(t.mediaObjectId),
    index('derived_previews_access_idx').on(t.lastAccessedAt),
  ],
);

export const duplicateCandidates = pgTable(
  'duplicate_candidates',
  {
    id: pk(),
    orgId: orgRef(),
    mediaAId: uuid('media_a_id')
      .notNull()
      .references(() => mediaObjects.id, { onDelete: 'cascade' }),
    mediaBId: uuid('media_b_id')
      .notNull()
      .references(() => mediaObjects.id, { onDelete: 'cascade' }),
    method: duplicateMethod('method').notNull(),
    score: doublePrecision('score').notNull().default(0),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    state: duplicateState('state').notNull().default('SUGGESTED'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: ts('reviewed_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('duplicate_candidates_pair_uq').on(t.orgId, t.mediaAId, t.mediaBId)],
);

export const mediaTags = pgTable(
  'media_tags',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('media_tags_org_name_uq').on(t.orgId, sql`lower(${t.name})`)],
);

export const assetTagLinks = pgTable(
  'asset_tag_links',
  {
    id: pk(),
    orgId: orgRef(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => logicalAssets.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => mediaTags.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('asset_tag_links_uq').on(t.assetId, t.tagId)],
);

export const fileTagLinks = pgTable(
  'file_tag_links',
  {
    id: pk(),
    orgId: orgRef(),
    fileInstanceId: uuid('file_instance_id')
      .notNull()
      .references(() => fileInstances.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => mediaTags.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('file_tag_links_uq').on(t.fileInstanceId, t.tagId)],
);

export const assetMatchSuggestions = pgTable(
  'asset_match_suggestions',
  {
    id: pk(),
    orgId: orgRef(),
    sourceType: text('source_type').notNull(), // 'file_instance' | 'publication'
    sourceId: uuid('source_id').notNull(),
    candidateAssetId: uuid('candidate_asset_id')
      .notNull()
      .references(() => logicalAssets.id, { onDelete: 'cascade' }),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    confidence: doublePrecision('confidence').notNull().default(0),
    outcome: text('outcome').notNull().default('PENDING'), // PENDING | ACCEPTED | REJECTED
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: ts('reviewed_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('asset_match_suggestions_uq').on(t.sourceType, t.sourceId, t.candidateAssetId)],
);
