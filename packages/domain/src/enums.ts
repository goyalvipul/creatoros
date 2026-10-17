/**
 * Single source of truth for every enumerated value. The DB package turns these into pgEnums,
 * the API turns them into zod enums, and the web app uses them for filters and labels.
 */

export const USER_ROLE = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export const USER_STATUS = ['ACTIVE', 'DISABLED'] as const;
export const MEMBERSHIP_STATUS = ['ACTIVE', 'INVITED', 'DISABLED'] as const;

export const PLATFORM = [
  'youtube',
  'instagram',
  'facebook',
  'tiktok',
  'snapchat',
  'x',
  'threads',
  'linkedin',
  'website',
  'other',
] as const;
export type Platform = (typeof PLATFORM)[number];

export const PROVIDER = [
  'google',
  'gmail',
  'youtube',
  'postiz',
  'todo',
  'meta', // LEGACY: Instagram Graph API via Facebook Login, token pasted by the owner
  'tiktok',
  'snapchat',
  'manual',
  'instagram', // Instagram API with Instagram Login (OAuth)
  'facebook', // Facebook Pages API with Facebook Login (not implemented yet)
  'threads', // Threads API (not implemented yet)
] as const;
export type Provider = (typeof PROVIDER)[number];

export const CONNECTION_STATE = [
  'NOT_CONFIGURED',
  'ACTIVE',
  'PAUSED',
  'DISABLED',
  'AUTH_EXPIRED',
  'PARTIAL_SYNC',
  'UNSUPPORTED',
  'OFFLINE',
  'ERROR',
] as const;
export type ConnectionState = (typeof CONNECTION_STATE)[number];

export const PROVENANCE = ['VERIFIED_PLATFORM', 'USER_ENTERED', 'ESTIMATED', 'UNKNOWN'] as const;
export type Provenance = (typeof PROVENANCE)[number];

/* ---------- storage ---------- */
export const DEVICE_STATE = ['PENDING', 'ONLINE', 'OFFLINE', 'REVOKED'] as const;
export type DeviceState = (typeof DEVICE_STATE)[number];
export const ROOT_STATE = ['ACTIVE', 'PAUSED', 'UNREACHABLE', 'RETIRED'] as const;
export type RootState = (typeof ROOT_STATE)[number];
export const ACCESS_METHOD = ['LOCAL', 'SMB', 'NFS_MOUNT', 'SERVER_MOUNT'] as const;
export const HASH_MODE = ['all', 'candidates', 'off'] as const;
export type HashMode = (typeof HASH_MODE)[number];

/** Stored (file level) availability. Machine/root level states are derived at read time. */
export const FILE_AVAILABILITY = [
  'AVAILABLE',
  'MACHINE_OFFLINE',
  'ROOT_UNREACHABLE',
  'MISSING_CANDIDATE',
  'CONFIRMED_MISSING',
  'PERMISSION_DENIED',
  'HASHING',
  'INCOMPLETE',
] as const;
export type FileAvailability = (typeof FILE_AVAILABILITY)[number];

export const PROBE_STATE = ['PENDING', 'STILL_WRITING', 'PROBING', 'INDEXED', 'PROBE_FAILED'] as const;
export type ProbeState = (typeof PROBE_STATE)[number];

export const FILE_KIND = ['VIDEO', 'AUDIO', 'IMAGE', 'DOCUMENT', 'PROJECT', 'OTHER'] as const;
export type FileKind = (typeof FILE_KIND)[number];

export const SCAN_JOB_TYPE = ['SCAN', 'RECONCILE', 'HEARTBEAT'] as const;
export const SCAN_STATUS = ['RUNNING', 'COMPLETED', 'FAILED', 'ABORTED'] as const;
export const VERIFICATION_STATE = ['VERIFIED', 'PROVISIONAL'] as const;
export const DUPLICATE_STATE = ['SUGGESTED', 'CONFIRMED', 'DISMISSED'] as const;
export const DUPLICATE_METHOD = ['EXACT_HASH', 'NEAR_DURATION_NAME', 'NEAR_NAME_SIZE', 'MANUAL'] as const;
export const PREVIEW_STATUS = ['READY', 'FAILED', 'PENDING'] as const;

/* ---------- assets / production ---------- */
export const ASSET_KIND = [
  'VIDEO',
  'AUDIO',
  'IMAGE',
  'DOCUMENT',
  'LYRICS',
  'SCRIPT',
  'THUMBNAIL',
  'OTHER',
] as const;
export type AssetKind = (typeof ASSET_KIND)[number];
export const CREATIVE_STATE = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const;
export const APPROVAL_STATE = ['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const;
export const VARIANT_TYPE = [
  'MASTER',
  'LONG_FORM',
  'SHORT_FORM',
  'REEL',
  'SHORTS',
  'LYRIC_VIDEO',
  'TEASER',
  'THUMBNAIL',
  'AUDIO_MASTER',
  'OTHER',
] as const;

export const IDEA_STATUS = ['NEW', 'RESEARCHING', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const;
export const PROJECT_STAGE = [
  'DRAFT',
  'APPROVED',
  'GENERATING',
  'EDITING',
  'QA',
  'READY',
  'DISTRIBUTING',
  'ARCHIVED',
] as const;
export type ProjectStage = (typeof PROJECT_STAGE)[number];
export const PROJECT_TYPE = [
  'SONG',
  'MUSIC_VIDEO',
  'SHORT_FORM',
  'CAMPAIGN',
  'TRAVEL_TOPIC',
  'FINANCE_TOPIC',
  'PRODUCT_UGC',
  'EDUCATION',
  'OTHER',
] as const;
export const CLIP_STATE = [
  'PLANNED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SELECTED',
  'REJECTED',
] as const;
export type ClipState = (typeof CLIP_STATE)[number];
export const GENERATION_STATUS = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export const OUTPUT_SELECTION = ['CANDIDATE', 'SELECTED', 'REJECTED'] as const;
export const CONTENT_FORMAT = [
  'MUSIC_SINGLE',
  'LYRIC_VIDEO',
  'PERFORMANCE_REEL',
  'SHORTS',
  'BEHIND_THE_SCENES',
  'PRODUCT_UGC',
  'TRAVEL_VLOG',
  'EDUCATION',
  'OTHER',
] as const;

/* ---------- publishing ---------- */
export const PUBLICATION_STATE = [
  'NOT_PLANNED',
  'PLANNED',
  'READY',
  'SCHEDULED',
  'SUBMITTED',
  'PROCESSING',
  'PUBLISHED_VERIFIED',
  'PUBLISHED_MANUAL',
  'FAILED',
  'UNKNOWN',
  'REMOVED',
] as const;
export type PublicationState = (typeof PUBLICATION_STATE)[number];
export const SCHEDULE_STATUS = ['PENDING', 'SUBMITTED', 'DONE', 'FAILED', 'CANCELLED'] as const;
export const PRIVACY = ['PUBLIC', 'UNLISTED', 'PRIVATE', 'SCHEDULED'] as const;

/* ---------- CRM ---------- */
export const DEAL_STAGE = [
  'NEW_INQUIRY',
  'TRIAGE',
  'QUALIFIED',
  'NEGOTIATING',
  'AGREED',
  'CONTRACTING',
  'IN_PRODUCTION',
  'AWAITING_BRAND',
  'REVISION_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'REPORTING',
  'AWAITING_PAYMENT',
  'PAID_CLOSED',
  'DECLINED',
  'LOST',
  'ON_HOLD',
] as const;
export type DealStage = (typeof DEAL_STAGE)[number];
export const CLOSED_DEAL_STAGES: readonly DealStage[] = ['PAID_CLOSED', 'DECLINED', 'LOST'];
export const COMPENSATION_TYPE = [
  'FLAT_FEE',
  'GIFTED',
  'AFFILIATE',
  'COMMISSION',
  'MIXED',
  'UNKNOWN',
] as const;
export const DELIVERABLE_STATUS = [
  'PLANNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'ACCEPTED',
] as const;
export const CONTRACT_STATUS = [
  'NONE',
  'DRAFT',
  'SENT',
  'SIGNED_BY_OWNER',
  'SIGNED_BOTH',
  'EXPIRED',
  'TERMINATED',
] as const;
export const MESSAGE_DIRECTION = ['INBOUND', 'OUTBOUND'] as const;
export const ACTIONABLE_STATE = ['NEED_REPLY', 'WAITING_FOR_BRAND', 'WAITING_FOR_USER', 'DONE'] as const;
export type ActionableState = (typeof ACTIONABLE_STATE)[number];
export const TRIAGE_STATE = ['POSSIBLE', 'CONFIRMED', 'DISMISSED', 'MERGED'] as const;
export const MESSAGE_SOURCE = ['GMAIL', 'MANUAL', 'INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'OTHER'] as const;
export const INVOICE_STATUS = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'] as const;
export const PAYMENT_METHOD = ['BANK_TRANSFER', 'PAYPAL', 'STRIPE', 'WISE', 'CASH', 'OTHER'] as const;
export const EXPENSE_CATEGORY = [
  'SOFTWARE',
  'GPU_COMPUTE',
  'MUSIC',
  'TALENT',
  'ADS',
  'TRAVEL',
  'OTHER',
] as const;
export const AMOUNT_KIND = ['ESTIMATED', 'CONTRACTED', 'INVOICED', 'RECEIVED'] as const;

/* ---------- actions / notifications ---------- */
export const ACTION_STATE = ['OPEN', 'SNOOZED', 'DONE', 'DISMISSED'] as const;
export type ActionState = (typeof ACTION_STATE)[number];
export const PRIORITY = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITY)[number];
export const SEVERITY = ['INFO', 'WARNING', 'CRITICAL'] as const;
export const SYNC_STATE = ['NOT_LINKED', 'PENDING', 'SYNCED', 'CONFLICT', 'FAILED', 'DEAD_LETTER'] as const;
export type SyncState = (typeof SYNC_STATE)[number];
export const JOB_STATUS = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELLED'] as const;
export const BACKUP_STATE = ['RUNNING', 'SUCCEEDED', 'FAILED', 'VERIFIED', 'RESTORED_TEST'] as const;
export const GOAL_KIND = ['ACTIVITY', 'OUTCOME'] as const;
export const GOAL_PERIOD = ['WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const;
export const GOAL_METRIC = [
  'RELEASES',
  'VIDEOS_PUBLISHED',
  'WATCH_HOURS',
  'REPLY_SLA_HOURS',
  'REVENUE_MINOR',
  'FOLLOWERS',
  'CUSTOM',
] as const;
export const EXTERNAL_ORG_KIND = ['BRAND', 'AGENCY', 'PLATFORM', 'OTHER'] as const;
export const OUTBOX_STATE = ['PENDING', 'DELIVERED', 'FAILED'] as const;

/** Labels used by the API/UI to explain the different "count" definitions (see spec 5.2). */
export const COUNT_DEFINITIONS = {
  physicalInstances:
    'Distinct physical file instances (every copy on every machine/path, current inventory).',
  exactMediaObjects:
    'Distinct exact media objects: verified full-hash groups plus un-hashed files (each un-hashed file is a provisional identity, never collapsed).',
  logicalVideoAssets:
    'Logical video assets (intended pieces of content), independent of copies and versions.',
  publications: 'Publication records per social account + platform with their own status/evidence.',
  readyToPublish: 'Approved export variants with at least one planned target that is not yet published.',
} as const;
