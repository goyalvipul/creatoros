import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, int8, pk, ts, updatedAt } from './columns';
import { orgRef, socialAccounts } from './identity';

const ACTIVE = sql`status in ('PREPARING','CREATING','CONNECTING','LIVE','INTERRUPTED','STOPPING')`;

export const streamMachines = pgTable(
  'stream_machines',
  {
    id: pk(),
    orgId: orgRef(),
    displayName: text('display_name').notNull(),
    os: text('os').notNull().default('linux'),
    hostname: text('hostname'),
    tokenHash: text('token_hash').notNull(),
    ffmpeg: text('ffmpeg'),
    encoders: jsonb('encoders').$type<string[]>().notNull().default([]),
    freeBytes: int8('free_bytes'),
    totalBytes: int8('total_bytes'),
    roots: jsonb('roots').$type<string[]>().notNull().default([]),
    browsePath: text('browse_path'),
    browseListing: jsonb('browse_listing').$type<{ name: string; relative: string; kind: 'dir' | 'video'; size: number }[]>(),
    currentSessionId: uuid('current_session_id'),
    lastSeenAt: ts('last_seen_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('stream_machines_token_uq').on(t.tokenHash),
    index('stream_machines_org_idx').on(t.orgId),
  ],
);

export const livePlaylists = pgTable(
  'live_playlists',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    items: jsonb('items').$type<Record<string, unknown>[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('live_playlists_org_idx').on(t.orgId)],
);

export const liveUploads = pgTable(
  'live_uploads',
  {
    id: pk(),
    orgId: orgRef(),
    fileName: text('file_name').notNull(),
    relativePath: text('relative_path'),
    byteSize: int8('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull().default('video/mp4'),
    createdAt: createdAt(),
  },
  (t) => [index('live_uploads_org_idx').on(t.orgId)],
);

export const liveSessions = pgTable(
  'live_sessions',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id'),
    playlistId: uuid('playlist_id').references(() => livePlaylists.id, { onDelete: 'set null' }),
    machineId: uuid('machine_id').references(() => streamMachines.id, { onDelete: 'set null' }),
    socialAccountId: uuid('social_account_id').references(() => socialAccounts.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    playlistName: text('playlist_name'),
    status: text('status').notNull().default('PREPARING'),
    stopReason: text('stop_reason'),
    error: text('error'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    playlistSnapshot: jsonb('playlist_snapshot').$type<Record<string, unknown>[]>().notNull().default([]),
    youtubeBroadcastId: text('youtube_broadcast_id'),
    youtubeStreamId: text('youtube_stream_id'),
    watchUrl: text('watch_url'),
    ingestSecret: text('ingest_secret'),
    youtubeBound: boolean('youtube_bound').notNull().default(false),
    metadataApplied: boolean('metadata_applied').notNull().default(false),
    policyNotifyMs: integer('policy_notify_ms'),
    policyStopMs: integer('policy_stop_ms').notNull(),
    jobCreatedAt: ts('job_created_at').notNull().defaultNow(),
    preparationStartedAt: ts('preparation_started_at'),
    encoderStartedAt: ts('encoder_started_at'),
    firstIngestAt: ts('first_ingest_at'),
    youtubeActualStartAt: ts('youtube_actual_start_at'),
    youtubeActualEndAt: ts('youtube_actual_end_at'),
    notifyAt: ts('notify_at'),
    autoStopAt: ts('auto_stop_at'),
    ingestSafetyAt: ts('ingest_safety_at'),
    encoderStoppedAt: ts('encoder_stopped_at'),
    lastHeartbeatAt: ts('last_heartbeat_at'),
    notifiedAt: ts('notified_at'),
    endedNotifiedAt: ts('ended_notified_at'),
    replayNotifiedAt: ts('replay_notified_at'),
    replayStatus: text('replay_status'),
    replayDetail: text('replay_detail'),
    nextVerifyAt: ts('next_verify_at'),
    youtubeCheckedAt: ts('youtube_checked_at'),
    verifiedLiveMs: integer('verified_live_ms').notNull().default(0),
    verifiedAt: ts('verified_at'),
    progress: jsonb('progress').$type<Record<string, unknown>>().notNull().default({}),
    logExcerpt: text('log_excerpt'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('live_sessions_org_idx').on(t.orgId, t.status),
    uniqueIndex('live_sessions_one_active_machine').on(t.machineId).where(ACTIVE),
    uniqueIndex('live_sessions_one_active_account').on(t.socialAccountId).where(sql`${t.socialAccountId} is not null and ${ACTIVE}`),
  ],
);
