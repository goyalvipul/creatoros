CREATE TYPE "public"."access_method" AS ENUM('LOCAL', 'SMB', 'NFS_MOUNT', 'SERVER_MOUNT');--> statement-breakpoint
CREATE TYPE "public"."action_state" AS ENUM('OPEN', 'SNOOZED', 'DONE', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."actionable_state" AS ENUM('NEED_REPLY', 'WAITING_FOR_BRAND', 'WAITING_FOR_USER', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."approval_state" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('VIDEO', 'AUDIO', 'IMAGE', 'DOCUMENT', 'LYRICS', 'SCRIPT', 'THUMBNAIL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."backup_state" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'VERIFIED', 'RESTORED_TEST');--> statement-breakpoint
CREATE TYPE "public"."clip_state" AS ENUM('PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SELECTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."compensation_type" AS ENUM('FLAT_FEE', 'GIFTED', 'AFFILIATE', 'COMMISSION', 'MIXED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."connection_state" AS ENUM('NOT_CONFIGURED', 'ACTIVE', 'PAUSED', 'DISABLED', 'AUTH_EXPIRED', 'PARTIAL_SYNC', 'UNSUPPORTED', 'OFFLINE', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."content_format" AS ENUM('MUSIC_SINGLE', 'LYRIC_VIDEO', 'PERFORMANCE_REEL', 'SHORTS', 'BEHIND_THE_SCENES', 'PRODUCT_UGC', 'TRAVEL_VLOG', 'EDUCATION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('NONE', 'DRAFT', 'SENT', 'SIGNED_BY_OWNER', 'SIGNED_BOTH', 'EXPIRED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."creative_state" AS ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."deal_stage" AS ENUM('NEW_INQUIRY', 'TRIAGE', 'QUALIFIED', 'NEGOTIATING', 'AGREED', 'CONTRACTING', 'IN_PRODUCTION', 'AWAITING_BRAND', 'REVISION_REQUESTED', 'APPROVED', 'PUBLISHED', 'REPORTING', 'AWAITING_PAYMENT', 'PAID_CLOSED', 'DECLINED', 'LOST', 'ON_HOLD');--> statement-breakpoint
CREATE TYPE "public"."deliverable_status" AS ENUM('PLANNED', 'IN_PROGRESS', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'ACCEPTED');--> statement-breakpoint
CREATE TYPE "public"."device_state" AS ENUM('PENDING', 'ONLINE', 'OFFLINE', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."duplicate_method" AS ENUM('EXACT_HASH', 'NEAR_DURATION_NAME', 'NEAR_NAME_SIZE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."duplicate_state" AS ENUM('SUGGESTED', 'CONFIRMED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('SOFTWARE', 'GPU_COMPUTE', 'MUSIC', 'TALENT', 'ADS', 'TRAVEL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."external_org_kind" AS ENUM('BRAND', 'AGENCY', 'PLATFORM', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."file_availability" AS ENUM('AVAILABLE', 'MACHINE_OFFLINE', 'ROOT_UNREACHABLE', 'MISSING_CANDIDATE', 'CONFIRMED_MISSING', 'PERMISSION_DENIED', 'HASHING', 'INCOMPLETE');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('VIDEO', 'AUDIO', 'IMAGE', 'DOCUMENT', 'PROJECT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."goal_kind" AS ENUM('ACTIVITY', 'OUTCOME');--> statement-breakpoint
CREATE TYPE "public"."goal_metric" AS ENUM('RELEASES', 'VIDEOS_PUBLISHED', 'WATCH_HOURS', 'REPLY_SLA_HOURS', 'REVENUE_MINOR', 'FOLLOWERS', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."goal_period" AS ENUM('WEEK', 'MONTH', 'QUARTER', 'YEAR');--> statement-breakpoint
CREATE TYPE "public"."hash_mode" AS ENUM('all', 'candidates', 'off');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('NEW', 'RESEARCHING', 'APPROVED', 'REJECTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('ACTIVE', 'INVITED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."message_source" AS ENUM('GMAIL', 'MANUAL', 'INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."outbox_state" AS ENUM('PENDING', 'DELIVERED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."output_selection" AS ENUM('CANDIDATE', 'SELECTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('BANK_TRANSFER', 'PAYPAL', 'STRIPE', 'WISE', 'CASH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('youtube', 'instagram', 'facebook', 'tiktok', 'snapchat', 'x', 'threads', 'linkedin', 'website', 'other');--> statement-breakpoint
CREATE TYPE "public"."preview_status" AS ENUM('READY', 'FAILED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."privacy" AS ENUM('PUBLIC', 'UNLISTED', 'PRIVATE', 'SCHEDULED');--> statement-breakpoint
CREATE TYPE "public"."probe_state" AS ENUM('PENDING', 'STILL_WRITING', 'PROBING', 'INDEXED', 'PROBE_FAILED');--> statement-breakpoint
CREATE TYPE "public"."project_stage" AS ENUM('DRAFT', 'APPROVED', 'GENERATING', 'EDITING', 'QA', 'READY', 'DISTRIBUTING', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."project_type" AS ENUM('SONG', 'MUSIC_VIDEO', 'SHORT_FORM', 'CAMPAIGN', 'TRAVEL_TOPIC', 'FINANCE_TOPIC', 'PRODUCT_UGC', 'EDUCATION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('VERIFIED_PLATFORM', 'USER_ENTERED', 'ESTIMATED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('google', 'gmail', 'youtube', 'postiz', 'todo', 'meta', 'tiktok', 'snapchat', 'manual');--> statement-breakpoint
CREATE TYPE "public"."publication_state" AS ENUM('NOT_PLANNED', 'PLANNED', 'READY', 'SCHEDULED', 'SUBMITTED', 'PROCESSING', 'PUBLISHED_VERIFIED', 'PUBLISHED_MANUAL', 'FAILED', 'UNKNOWN', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."root_state" AS ENUM('ACTIVE', 'PAUSED', 'UNREACHABLE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."scan_job_type" AS ENUM('SCAN', 'RECONCILE', 'HEARTBEAT');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED', 'ABORTED');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('PENDING', 'SUBMITTED', 'DONE', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('INFO', 'WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."sync_state" AS ENUM('NOT_LINKED', 'PENDING', 'SYNCED', 'CONFLICT', 'FAILED', 'DEAD_LETTER');--> statement-breakpoint
CREATE TYPE "public"."triage_state" AS ENUM('POSSIBLE', 'CONFIRMED', 'DISMISSED', 'MERGED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('OWNER', 'EDITOR', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."variant_type" AS ENUM('MASTER', 'LONG_FORM', 'SHORT_FORM', 'REEL', 'SHORTS', 'LYRIC_VIDEO', 'TEASER', 'THUMBNAIL', 'AUDIO_MASTER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."verification_state" AS ENUM('VERIFIED', 'PROVISIONAL');--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'creator' NOT NULL,
	"description" text,
	"content_pillars" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"language" text DEFAULT 'en' NOT NULL,
	"goals" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'OWNER' NOT NULL,
	"status" "membership_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"base_currency" text DEFAULT 'CAD' NOT NULL,
	"timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setup_step" text DEFAULT 'welcome' NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"label" text,
	"principal_hint" text,
	"state" "connection_state" DEFAULT 'NOT_CONFIGURED' NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"encrypted_token_ref" text,
	"expires_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"token_hash" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"handle" text NOT NULL,
	"external_account_id" text,
	"profile_url" text,
	"account_type" text DEFAULT 'creator' NOT NULL,
	"verified_link" boolean DEFAULT false NOT NULL,
	"capability_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_connection_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'OWNER' NOT NULL,
	"timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"locale" text DEFAULT 'en-CA' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"totp_secret_enc" text,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_file_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"file_instance_id" uuid NOT NULL,
	"link_reason" text DEFAULT 'manual' NOT NULL,
	"confidence" double precision,
	"confirmed_by" uuid,
	"primary_preference" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_match_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"candidate_asset_id" uuid NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"outcome" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_tag_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"label" text DEFAULT 'v1' NOT NULL,
	"number" integer DEFAULT 1 NOT NULL,
	"media_object_id" uuid,
	"variant_type" "variant_type" DEFAULT 'MASTER' NOT NULL,
	"approval_state" "approval_state" DEFAULT 'PENDING' NOT NULL,
	"parent_version_id" uuid,
	"resolution" text,
	"intended_use" text,
	"notes" text,
	"is_master" boolean DEFAULT false NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "derived_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_instance_id" uuid,
	"media_object_id" uuid,
	"variant_key" text DEFAULT 'thumb' NOT NULL,
	"relative_cache_path" text NOT NULL,
	"content_type" text DEFAULT 'image/jpeg' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"status" "preview_status" DEFAULT 'READY' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"pairing_audit" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_device_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"device_uuid" uuid NOT NULL,
	"display_name" text NOT NULL,
	"hostname" text,
	"os" text,
	"hardware_label" text,
	"agent_version" text,
	"last_seen_at" timestamp with time zone,
	"state" "device_state" DEFAULT 'PENDING' NOT NULL,
	"tailscale_hint" text,
	"listen_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"signing_key_enc" text,
	"last_error" text,
	"load" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"media_a_id" uuid NOT NULL,
	"media_b_id" uuid NOT NULL,
	"method" "duplicate_method" NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" "duplicate_state" DEFAULT 'SUGGESTED' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"root_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"canonical_path" text NOT NULL,
	"display_path" text NOT NULL,
	"file_name" text NOT NULL,
	"ext" text DEFAULT '' NOT NULL,
	"file_id" text,
	"size" bigint DEFAULT 0 NOT NULL,
	"mtime" timestamp with time zone,
	"ctime" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_run_id" uuid,
	"availability" "file_availability" DEFAULT 'AVAILABLE' NOT NULL,
	"missing_since" timestamp with time zone,
	"missing_checks" integer DEFAULT 0 NOT NULL,
	"quick_signature" text,
	"full_hash" text,
	"hash_alg" text,
	"media_object_id" uuid,
	"file_type" "file_kind" DEFAULT 'OTHER' NOT NULL,
	"mime" text,
	"probe_state" "probe_state" DEFAULT 'PENDING' NOT NULL,
	"tech" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stable_observations" integer DEFAULT 0 NOT NULL,
	"previous_instance_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_tag_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_instance_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logical_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid,
	"project_id" uuid,
	"kind" "asset_kind" DEFAULT 'VIDEO' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"creative_state" "creative_state" DEFAULT 'DRAFT' NOT NULL,
	"selected_version_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"exact_hash" text NOT NULL,
	"hash_alg" text DEFAULT 'sha256' NOT NULL,
	"size" bigint NOT NULL,
	"mime" text,
	"kind" "file_kind" DEFAULT 'OTHER' NOT NULL,
	"tech" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verification_state" "verification_state" DEFAULT 'VERIFIED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physical_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"host" text,
	"share_name" text,
	"unc_path" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"root_id" uuid NOT NULL,
	"agent_event_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"file_identity" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text DEFAULT 'APPLIED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"root_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"job_type" "scan_job_type" DEFAULT 'SCAN' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "scan_status" DEFAULT 'RUNNING' NOT NULL,
	"scanned_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"changed_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"complete_success" boolean DEFAULT false NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_roots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"physical_share_id" uuid,
	"label" text NOT NULL,
	"display_path" text NOT NULL,
	"canonical_path" text NOT NULL,
	"path_os" text DEFAULT 'windows' NOT NULL,
	"smb_path" text,
	"mount_path" text,
	"access_method" "access_method" DEFAULT 'LOCAL' NOT NULL,
	"recursive" boolean DEFAULT true NOT NULL,
	"include_globs" text[] DEFAULT '{}'::text[] NOT NULL,
	"exclude_globs" text[] DEFAULT '{}'::text[] NOT NULL,
	"extensions" text[] DEFAULT '{}'::text[] NOT NULL,
	"scan_interval_minutes" integer DEFAULT 360 NOT NULL,
	"settle_seconds" integer DEFAULT 60 NOT NULL,
	"hash_mode" "hash_mode" DEFAULT 'all' NOT NULL,
	"follow_links" boolean DEFAULT false NOT NULL,
	"read_only" boolean DEFAULT true NOT NULL,
	"brand_id" uuid,
	"project_id" uuid,
	"auto_tag_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" "root_state" DEFAULT 'ACTIVE' NOT NULL,
	"scan_requested_at" timestamp with time zone,
	"reconcile_requested_at" timestamp with time zone,
	"last_scan_at" timestamp with time zone,
	"last_successful_scan_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"consecutive_complete_scans" integer DEFAULT 0 NOT NULL,
	"health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"cadence" text,
	"target_per_period" integer,
	"period" "goal_period" DEFAULT 'WEEK' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid,
	"channel_id" uuid,
	"source_idea_id" uuid,
	"series_id" uuid,
	"type" "project_type" DEFAULT 'OTHER' NOT NULL,
	"content_format" "content_format" DEFAULT 'OTHER' NOT NULL,
	"title" text NOT NULL,
	"stage" "project_stage" DEFAULT 'DRAFT' NOT NULL,
	"owner_user_id" uuid,
	"due_at" timestamp with time zone,
	"brief" text,
	"concept" text,
	"approved_direction" text,
	"parent_project_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"priority" "priority" DEFAULT 'NORMAL' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_completion_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"scene_id" uuid,
	"device_id" uuid,
	"provider" text DEFAULT 'comfyui' NOT NULL,
	"external_job_id" text,
	"prompt_id" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"status" "generation_status" DEFAULT 'QUEUED' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workflow" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"asset_version_id" uuid,
	"file_instance_id" uuid,
	"expected_path" text,
	"sha256" text,
	"node" text,
	"output_role" text DEFAULT 'output' NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	"selection_state" "output_selection" DEFAULT 'CANDIDATE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid,
	"channel_id" uuid,
	"title" text NOT NULL,
	"pitch" text,
	"creative_brief" text,
	"notes" text,
	"genre" text,
	"content_pillars" text[] DEFAULT '{}'::text[] NOT NULL,
	"reference_links" text[] DEFAULT '{}'::text[] NOT NULL,
	"voice_note_file_id" uuid,
	"language" text DEFAULT 'en' NOT NULL,
	"format" "content_format" DEFAULT 'OTHER' NOT NULL,
	"audience" text,
	"score" integer,
	"effort_hours" integer,
	"priority" "priority" DEFAULT 'NORMAL' NOT NULL,
	"status" "idea_status" DEFAULT 'NEW' NOT NULL,
	"storyboard" text,
	"lyrics_draft" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"converted_project_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "production_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text,
	"timecode_start_ms" integer,
	"timecode_end_ms" integer,
	"narration" text,
	"direction" text,
	"shot_prompt" text,
	"audio_segment_asset_id" uuid,
	"reference_asset_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "clip_state" DEFAULT 'PLANNED' NOT NULL,
	"selected_version_id" uuid,
	"qa_notes" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"deal_id" uuid,
	"asset_id" uuid,
	"file_instance_id" uuid,
	"label" text,
	"purpose" text DEFAULT 'reference' NOT NULL,
	"access_level" text DEFAULT 'ORG' NOT NULL,
	"stored_path" text,
	"mime" text,
	"size_bytes" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"template_id" uuid,
	"label" text NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"stage" text,
	"required" boolean DEFAULT true NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"content_type" "content_format" DEFAULT 'OTHER' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variants" text[] DEFAULT '{}'::text[] NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'EDITOR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"from_stage" "project_stage",
	"to_stage" "project_stage" NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"brand_id" uuid,
	"title" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"genre" text,
	"bpm" integer,
	"musical_key" text,
	"lyrics" text,
	"lyrics_asset_id" uuid,
	"audio_master_asset_id" uuid,
	"suno_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "distribution_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"asset_version_id" uuid,
	"project_id" uuid,
	"channel_id" uuid,
	"format" "variant_type" DEFAULT 'MASTER' NOT NULL,
	"title_master" text NOT NULL,
	"caption_master" text,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"cta" text,
	"thumbnail_asset_id" uuid,
	"is_sponsored" boolean DEFAULT false NOT NULL,
	"readiness" text DEFAULT 'DRAFT' NOT NULL,
	"target_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_metrics_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"views" bigint,
	"watch_time_seconds" bigint,
	"impressions" bigint,
	"likes" bigint,
	"comments" bigint,
	"shares" bigint,
	"saves" bigint,
	"followers_gained" bigint,
	"avg_view_pct" double precision,
	"provenance" "provenance" DEFAULT 'UNKNOWN' NOT NULL,
	"provider_meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"target_id" uuid,
	"variant_id" uuid,
	"asset_version_id" uuid,
	"social_account_id" uuid NOT NULL,
	"provider" "provider" DEFAULT 'manual' NOT NULL,
	"external_post_id" text,
	"canonical_url" text,
	"title" text,
	"caption" text,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"tagged_products" text[] DEFAULT '{}'::text[] NOT NULL,
	"privacy" "privacy" DEFAULT 'PUBLIC' NOT NULL,
	"language" text,
	"cta" text,
	"accessibility_captions" text,
	"thumbnail_asset_id" uuid,
	"is_sponsored" boolean DEFAULT false NOT NULL,
	"sponsor_disclosure" boolean DEFAULT false NOT NULL,
	"deliverable_id" uuid,
	"state" "publication_state" DEFAULT 'PLANNED' NOT NULL,
	"state_provenance" "provenance" DEFAULT 'USER_ENTERED' NOT NULL,
	"state_evidence" text,
	"planned_at" timestamp with time zone,
	"planned_timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"published_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"failure_reason" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone,
	"unmatched_import" boolean DEFAULT false NOT NULL,
	"attribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latest_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_state" "publication_state",
	"to_state" "publication_state",
	"source" text DEFAULT 'user' NOT NULL,
	"provenance" "provenance" DEFAULT 'USER_ENTERED' NOT NULL,
	"evidence" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"desired" boolean DEFAULT true NOT NULL,
	"desired_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishing_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"planned_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"status" "schedule_status" DEFAULT 'PENDING' NOT NULL,
	"connector_job_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"external_org_id" uuid,
	"name" text NOT NULL,
	"emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"handles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"websites" text[] DEFAULT '{}'::text[] NOT NULL,
	"timezone" text,
	"preferred_comms" text,
	"reply_sla_hours" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversation_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_connection_id" uuid,
	"source" "message_source" DEFAULT 'MANUAL' NOT NULL,
	"principal" text,
	"provider_thread_id" text,
	"subject" text,
	"external_org_id" uuid,
	"contact_id" uuid,
	"brand_id" uuid,
	"opportunity_id" uuid,
	"deal_id" uuid,
	"triage_state" "triage_state" DEFAULT 'POSSIBLE' NOT NULL,
	"state" "actionable_state" DEFAULT 'NEED_REPLY' NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"last_answered_at" timestamp with time zone,
	"snooze_until" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"external_link" text,
	"merged_into_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"document_ref" text,
	"effective_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"rights" text,
	"approval_state" text DEFAULT 'PENDING' NOT NULL,
	"signature_state" "contract_status" DEFAULT 'NONE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"project_id" uuid,
	"asset_version_id" uuid,
	"publication_id" uuid,
	"format" text,
	"platform" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"specs" text,
	"due_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approval_evidence" text,
	"approval_confirmed_by" uuid,
	"status" "deliverable_status" DEFAULT 'PLANNED' NOT NULL,
	"revision_rounds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"external_org_id" uuid,
	"contact_id" uuid,
	"brand_id" uuid,
	"channel_id" uuid,
	"title" text NOT NULL,
	"campaign" text,
	"pitch" text,
	"stage" "deal_stage" DEFAULT 'NEW_INQUIRY' NOT NULL,
	"compensation_type" "compensation_type" DEFAULT 'UNKNOWN' NOT NULL,
	"contracted_value_minor" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"tax_terms" text,
	"usage_rights" text,
	"exclusivity" text,
	"territories" text,
	"embargo_until" timestamp with time zone,
	"licensing" text,
	"deliverables_summary" text,
	"revision_rounds" integer DEFAULT 1 NOT NULL,
	"contract_status" "contract_status" DEFAULT 'NONE' NOT NULL,
	"signed_at" timestamp with time zone,
	"internal_notes" text,
	"priority" "priority" DEFAULT 'NORMAL' NOT NULL,
	"owner_user_id" uuid,
	"payment_terms" text,
	"payment_terms_days" integer,
	"budget_minor" bigint,
	"cost_minor" bigint,
	"expected_margin_pct" numeric(6, 2),
	"next_due_at" timestamp with time zone,
	"approval_rules" text,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"deal_id" uuid,
	"project_id" uuid,
	"description" text,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"category" "expense_category" DEFAULT 'OTHER' NOT NULL,
	"incurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "external_org_kind" DEFAULT 'BRAND' NOT NULL,
	"website" text,
	"sector" text,
	"handles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "follow_up_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"source_type" text DEFAULT 'thread' NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_hours" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"rate_date" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"category" text NOT NULL,
	"extracted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"algorithm" text DEFAULT 'rules-v1' NOT NULL,
	"review_outcome" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"deal_id" uuid,
	"invoice_no" text NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"paid_total_minor" bigint DEFAULT 0 NOT NULL,
	"file_ref" text,
	"fx_rate" numeric(18, 8),
	"fx_rate_date" timestamp with time zone,
	"fx_source" text,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"source" "message_source" DEFAULT 'MANUAL' NOT NULL,
	"principal" text,
	"provider_msg_id" text,
	"direction" "message_direction" DEFAULT 'INBOUND' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_email" text,
	"from_name" text,
	"to_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text,
	"body_preview" text,
	"body_enc" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"attachment_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_checksum" text NOT NULL,
	"provenance" "provenance" DEFAULT 'USER_ENTERED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_thread_id" uuid,
	"brand_id" uuid,
	"channel_id" uuid,
	"external_org_id" uuid,
	"contact_id" uuid,
	"title" text NOT NULL,
	"offer_type" "compensation_type" DEFAULT 'UNKNOWN' NOT NULL,
	"stage" "deal_stage" DEFAULT 'NEW_INQUIRY' NOT NULL,
	"predicted_value_minor" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"probability_pct" integer,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" "payment_method" DEFAULT 'OTHER' NOT NULL,
	"reference" text,
	"proof_ref" text,
	"verified" boolean DEFAULT false NOT NULL,
	"provenance" "provenance" DEFAULT 'USER_ENTERED' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid,
	"channel_id" uuid,
	"social_account_id" uuid,
	"period" text DEFAULT 'DAY' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone,
	"timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" "provenance" DEFAULT 'UNKNOWN' NOT NULL,
	"source" text DEFAULT 'computed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"key" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"object_type" text,
	"object_id" text,
	"before" jsonb,
	"after" jsonb,
	"correlation_id" text,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frequency" text DEFAULT 'on_event' NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"safe_only" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"type" text NOT NULL,
	"queue" text,
	"external_job_id" text,
	"source" text,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"fail_reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"kind" text DEFAULT 'manual' NOT NULL,
	"state" "backup_state" DEFAULT 'RUNNING' NOT NULL,
	"target" text,
	"checksum_sha256" text,
	"size_bytes" bigint,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"restore_test_ref" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "goal_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"actual" double precision NOT NULL,
	"source" "provenance" DEFAULT 'ESTIMATED' NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid,
	"channel_id" uuid,
	"name" text NOT NULL,
	"period" "goal_period" DEFAULT 'MONTH' NOT NULL,
	"metric" "goal_metric" DEFAULT 'RELEASES' NOT NULL,
	"custom_metric" text,
	"target_value" double precision NOT NULL,
	"unit" text DEFAULT 'count' NOT NULL,
	"kind" "goal_kind" DEFAULT 'ACTIVITY' NOT NULL,
	"provenance" "provenance" DEFAULT 'USER_ENTERED' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"rule_key" text,
	"dedupe_key" text,
	"title" text NOT NULL,
	"description" text,
	"reason" text,
	"deep_link" text,
	"due_at" timestamp with time zone,
	"priority" "priority" DEFAULT 'NORMAL' NOT NULL,
	"state" "action_state" DEFAULT 'OPEN' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completion_evidence" text,
	"owner_user_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"quiet_start" text DEFAULT '22:00',
	"quiet_end" text DEFAULT '07:00',
	"in_app" boolean DEFAULT true NOT NULL,
	"browser_push" boolean DEFAULT false NOT NULL,
	"digest_hour" integer DEFAULT 8 NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"source_type" text,
	"source_id" uuid,
	"type" text NOT NULL,
	"dedupe_key" text,
	"title" text NOT NULL,
	"body" text,
	"severity" "severity" DEFAULT 'INFO' NOT NULL,
	"deep_link" text,
	"read_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivered_via" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"provider" "provider" NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier_enc" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "outbox_state" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings_and_feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"scope" text DEFAULT 'org' NOT NULL,
	"key" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"cursor" text,
	"last_success_at" timestamp with time zone,
	"restart_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_connection_id" uuid,
	"name" text DEFAULT 'Todo PWA' NOT NULL,
	"base_url" text,
	"sync_direction" text DEFAULT 'BOTH' NOT NULL,
	"conflict_policy" text DEFAULT 'TODO_OWNS_DUE_AND_COMPLETION' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"endpoint_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_reconcile_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"remote_task_id" text,
	"remote_revision" text,
	"idempotency_key" text NOT NULL,
	"sync_state" "sync_state" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"last_local_hash" text,
	"remote_due_at" timestamp with time zone,
	"remote_completed_at" timestamp with time zone,
	"conflict_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sync_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_file_links" ADD CONSTRAINT "asset_file_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_file_links" ADD CONSTRAINT "asset_file_links_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_file_links" ADD CONSTRAINT "asset_file_links_file_instance_id_file_instances_id_fk" FOREIGN KEY ("file_instance_id") REFERENCES "public"."file_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_file_links" ADD CONSTRAINT "asset_file_links_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_match_suggestions" ADD CONSTRAINT "asset_match_suggestions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_match_suggestions" ADD CONSTRAINT "asset_match_suggestions_candidate_asset_id_logical_assets_id_fk" FOREIGN KEY ("candidate_asset_id") REFERENCES "public"."logical_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_match_suggestions" ADD CONSTRAINT "asset_match_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_links" ADD CONSTRAINT "asset_tag_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_links" ADD CONSTRAINT "asset_tag_links_asset_id_logical_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."logical_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_links" ADD CONSTRAINT "asset_tag_links_tag_id_media_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."media_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_logical_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."logical_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_parent_version_id_asset_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derived_previews" ADD CONSTRAINT "derived_previews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derived_previews" ADD CONSTRAINT "derived_previews_file_instance_id_file_instances_id_fk" FOREIGN KEY ("file_instance_id") REFERENCES "public"."file_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derived_previews" ADD CONSTRAINT "derived_previews_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_used_by_device_id_devices_id_fk" FOREIGN KEY ("used_by_device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_media_a_id_media_objects_id_fk" FOREIGN KEY ("media_a_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_media_b_id_media_objects_id_fk" FOREIGN KEY ("media_b_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_instances" ADD CONSTRAINT "file_instances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_instances" ADD CONSTRAINT "file_instances_root_id_storage_roots_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."storage_roots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_instances" ADD CONSTRAINT "file_instances_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_instances" ADD CONSTRAINT "file_instances_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_instances" ADD CONSTRAINT "file_instances_previous_instance_id_file_instances_id_fk" FOREIGN KEY ("previous_instance_id") REFERENCES "public"."file_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_tag_links" ADD CONSTRAINT "file_tag_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_tag_links" ADD CONSTRAINT "file_tag_links_file_instance_id_file_instances_id_fk" FOREIGN KEY ("file_instance_id") REFERENCES "public"."file_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_tag_links" ADD CONSTRAINT "file_tag_links_tag_id_media_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."media_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_assets" ADD CONSTRAINT "logical_assets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_assets" ADD CONSTRAINT "logical_assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_assets" ADD CONSTRAINT "logical_assets_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_assets" ADD CONSTRAINT "logical_assets_selected_version_id_asset_versions_id_fk" FOREIGN KEY ("selected_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_tags" ADD CONSTRAINT "media_tags_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_shares" ADD CONSTRAINT "physical_shares_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_observations" ADD CONSTRAINT "scan_observations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_observations" ADD CONSTRAINT "scan_observations_root_id_storage_roots_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."storage_roots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_root_id_storage_roots_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."storage_roots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_roots" ADD CONSTRAINT "storage_roots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_roots" ADD CONSTRAINT "storage_roots_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_roots" ADD CONSTRAINT "storage_roots_physical_share_id_physical_shares_id_fk" FOREIGN KEY ("physical_share_id") REFERENCES "public"."physical_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_roots" ADD CONSTRAINT "storage_roots_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_roots" ADD CONSTRAINT "storage_roots_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_series" ADD CONSTRAINT "content_series_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_series" ADD CONSTRAINT "content_series_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD CONSTRAINT "creative_projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD CONSTRAINT "creative_projects_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD CONSTRAINT "creative_projects_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD CONSTRAINT "creative_projects_source_idea_id_ideas_id_fk" FOREIGN KEY ("source_idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD CONSTRAINT "creative_projects_series_id_content_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."content_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD CONSTRAINT "creative_projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD CONSTRAINT "creative_projects_parent_project_id_creative_projects_id_fk" FOREIGN KEY ("parent_project_id") REFERENCES "public"."creative_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_scene_id_production_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."production_scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_outputs" ADD CONSTRAINT "generation_outputs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_outputs" ADD CONSTRAINT "generation_outputs_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_outputs" ADD CONSTRAINT "generation_outputs_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_outputs" ADD CONSTRAINT "generation_outputs_file_instance_id_file_instances_id_fk" FOREIGN KEY ("file_instance_id") REFERENCES "public"."file_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_voice_note_file_id_file_instances_id_fk" FOREIGN KEY ("voice_note_file_id") REFERENCES "public"."file_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_converted_project_id_creative_projects_id_fk" FOREIGN KEY ("converted_project_id") REFERENCES "public"."creative_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_scenes" ADD CONSTRAINT "production_scenes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_scenes" ADD CONSTRAINT "production_scenes_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_scenes" ADD CONSTRAINT "production_scenes_audio_segment_asset_id_logical_assets_id_fk" FOREIGN KEY ("audio_segment_asset_id") REFERENCES "public"."logical_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_scenes" ADD CONSTRAINT "production_scenes_selected_version_id_asset_versions_id_fk" FOREIGN KEY ("selected_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_asset_id_logical_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."logical_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_file_instance_id_file_instances_id_fk" FOREIGN KEY ("file_instance_id") REFERENCES "public"."file_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_template_id_project_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."project_checklist_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_templates" ADD CONSTRAINT "project_checklist_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status_events" ADD CONSTRAINT "project_status_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status_events" ADD CONSTRAINT "project_status_events_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status_events" ADD CONSTRAINT "project_status_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_lyrics_asset_id_logical_assets_id_fk" FOREIGN KEY ("lyrics_asset_id") REFERENCES "public"."logical_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_audio_master_asset_id_logical_assets_id_fk" FOREIGN KEY ("audio_master_asset_id") REFERENCES "public"."logical_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_variants" ADD CONSTRAINT "distribution_variants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_variants" ADD CONSTRAINT "distribution_variants_asset_id_logical_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."logical_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_variants" ADD CONSTRAINT "distribution_variants_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_variants" ADD CONSTRAINT "distribution_variants_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_variants" ADD CONSTRAINT "distribution_variants_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_variants" ADD CONSTRAINT "distribution_variants_thumbnail_asset_id_logical_assets_id_fk" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "public"."logical_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_metrics_snapshots" ADD CONSTRAINT "publication_metrics_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_metrics_snapshots" ADD CONSTRAINT "publication_metrics_snapshots_publication_id_publication_records_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_records" ADD CONSTRAINT "publication_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_records" ADD CONSTRAINT "publication_records_target_id_publication_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."publication_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_records" ADD CONSTRAINT "publication_records_variant_id_distribution_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."distribution_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_records" ADD CONSTRAINT "publication_records_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_records" ADD CONSTRAINT "publication_records_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_records" ADD CONSTRAINT "publication_records_thumbnail_asset_id_logical_assets_id_fk" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "public"."logical_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_records" ADD CONSTRAINT "publication_records_deliverable_id_deal_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deal_deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_records" ADD CONSTRAINT "publication_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_status_events" ADD CONSTRAINT "publication_status_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_status_events" ADD CONSTRAINT "publication_status_events_publication_id_publication_records_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_status_events" ADD CONSTRAINT "publication_status_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_targets" ADD CONSTRAINT "publication_targets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_targets" ADD CONSTRAINT "publication_targets_variant_id_distribution_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."distribution_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_targets" ADD CONSTRAINT "publication_targets_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_schedules" ADD CONSTRAINT "publishing_schedules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_schedules" ADD CONSTRAINT "publishing_schedules_publication_id_publication_records_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_external_org_id_external_organizations_id_fk" FOREIGN KEY ("external_org_id") REFERENCES "public"."external_organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_external_org_id_external_organizations_id_fk" FOREIGN KEY ("external_org_id") REFERENCES "public"."external_organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_merged_into_id_conversation_threads_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."conversation_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contracts" ADD CONSTRAINT "deal_contracts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contracts" ADD CONSTRAINT "deal_contracts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_deliverables" ADD CONSTRAINT "deal_deliverables_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_deliverables" ADD CONSTRAINT "deal_deliverables_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_deliverables" ADD CONSTRAINT "deal_deliverables_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_deliverables" ADD CONSTRAINT "deal_deliverables_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_deliverables" ADD CONSTRAINT "deal_deliverables_publication_id_publication_records_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_deliverables" ADD CONSTRAINT "deal_deliverables_approval_confirmed_by_users_id_fk" FOREIGN KEY ("approval_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_external_org_id_external_organizations_id_fk" FOREIGN KEY ("external_org_id") REFERENCES "public"."external_organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."creative_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_organizations" ADD CONSTRAINT "external_organizations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_classifications" ADD CONSTRAINT "inbound_classifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_classifications" ADD CONSTRAINT "inbound_classifications_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_classifications" ADD CONSTRAINT "inbound_classifications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_source_thread_id_conversation_threads_id_fk" FOREIGN KEY ("source_thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_external_org_id_external_organizations_id_fk" FOREIGN KEY ("external_org_id") REFERENCES "public"."external_organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_observations" ADD CONSTRAINT "goal_observations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_observations" ADD CONSTRAINT "goal_observations_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_actions" ADD CONSTRAINT "internal_actions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_actions" ADD CONSTRAINT "internal_actions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_and_feature_flags" ADD CONSTRAINT "settings_and_feature_flags_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_integrations" ADD CONSTRAINT "task_integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_integrations" ADD CONSTRAINT "task_integrations_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_action_id_internal_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."internal_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_integration_id_task_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."task_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_org_name_uq" ON "brands" USING btree ("org_id",lower("name")) WHERE "brands"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "channels_brand_idx" ON "channels" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "organization_memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "provider_connections_org_provider_idx" ON "provider_connections" USING btree ("org_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_uq" ON "social_accounts" USING btree ("org_id","platform",lower("handle")) WHERE "social_accounts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "social_accounts_channel_idx" ON "social_accounts" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "asset_file_links_pair_uq" ON "asset_file_links" USING btree ("asset_version_id","file_instance_id");--> statement-breakpoint
CREATE INDEX "asset_file_links_file_idx" ON "asset_file_links" USING btree ("file_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_match_suggestions_uq" ON "asset_match_suggestions" USING btree ("source_type","source_id","candidate_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_tag_links_uq" ON "asset_tag_links" USING btree ("asset_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_versions_number_uq" ON "asset_versions" USING btree ("asset_id","number");--> statement-breakpoint
CREATE INDEX "asset_versions_media_idx" ON "asset_versions" USING btree ("media_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "derived_previews_instance_variant_uq" ON "derived_previews" USING btree ("file_instance_id","variant_key");--> statement-breakpoint
CREATE INDEX "derived_previews_media_idx" ON "derived_previews" USING btree ("media_object_id");--> statement-breakpoint
CREATE INDEX "derived_previews_access_idx" ON "derived_previews" USING btree ("last_accessed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_credentials_token_uq" ON "device_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "device_credentials_device_idx" ON "device_credentials" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pairing_codes_hash_uq" ON "device_pairing_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_org_uuid_uq" ON "devices" USING btree ("org_id","device_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_candidates_pair_uq" ON "duplicate_candidates" USING btree ("org_id","media_a_id","media_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_instances_root_path_uq" ON "file_instances" USING btree ("root_id","canonical_path") WHERE "file_instances"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "file_instances_org_hash_idx" ON "file_instances" USING btree ("org_id","full_hash");--> statement-breakpoint
CREATE INDEX "file_instances_org_sig_idx" ON "file_instances" USING btree ("org_id","size","quick_signature");--> statement-breakpoint
CREATE INDEX "file_instances_device_idx" ON "file_instances" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "file_instances_org_type_idx" ON "file_instances" USING btree ("org_id","file_type");--> statement-breakpoint
CREATE INDEX "file_instances_media_idx" ON "file_instances" USING btree ("media_object_id");--> statement-breakpoint
CREATE INDEX "file_instances_root_seen_idx" ON "file_instances" USING btree ("root_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "file_instances_file_id_idx" ON "file_instances" USING btree ("root_id","file_id");--> statement-breakpoint
CREATE INDEX "file_instances_org_name_idx" ON "file_instances" USING btree ("org_id","file_name");--> statement-breakpoint
CREATE UNIQUE INDEX "file_tag_links_uq" ON "file_tag_links" USING btree ("file_instance_id","tag_id");--> statement-breakpoint
CREATE INDEX "logical_assets_org_kind_idx" ON "logical_assets" USING btree ("org_id","kind");--> statement-breakpoint
CREATE INDEX "logical_assets_project_idx" ON "logical_assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "logical_assets_brand_idx" ON "logical_assets" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_objects_hash_uq" ON "media_objects" USING btree ("org_id","hash_alg","exact_hash","size") WHERE "media_objects"."verification_state" = 'VERIFIED';--> statement-breakpoint
CREATE UNIQUE INDEX "media_tags_org_name_uq" ON "media_tags" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "scan_observations_event_uq" ON "scan_observations" USING btree ("root_id","agent_event_id");--> statement-breakpoint
CREATE INDEX "scan_observations_received_idx" ON "scan_observations" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_runs_run_uq" ON "scan_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "scan_runs_root_idx" ON "scan_runs" USING btree ("root_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_roots_device_path_uq" ON "storage_roots" USING btree ("device_id","canonical_path") WHERE "storage_roots"."state" <> 'RETIRED';--> statement-breakpoint
CREATE INDEX "storage_roots_org_idx" ON "storage_roots" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "creative_projects_org_stage_idx" ON "creative_projects" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "creative_projects_brand_idx" ON "creative_projects" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "creative_projects_due_idx" ON "creative_projects" USING btree ("org_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_external_uq" ON "generation_jobs" USING btree ("org_id","provider","external_job_id") WHERE "generation_jobs"."external_job_id" is not null;--> statement-breakpoint
CREATE INDEX "generation_jobs_scene_idx" ON "generation_jobs" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "generation_outputs_job_idx" ON "generation_outputs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "generation_outputs_file_idx" ON "generation_outputs" USING btree ("file_instance_id");--> statement-breakpoint
CREATE INDEX "ideas_org_status_idx" ON "ideas" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "ideas_brand_idx" ON "ideas" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_scenes_ordinal_uq" ON "production_scenes" USING btree ("project_id","ordinal");--> statement-breakpoint
CREATE INDEX "project_attachments_project_idx" ON "project_attachments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_attachments_deal_idx" ON "project_attachments" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "project_checklist_items_project_idx" ON "project_checklist_items" USING btree ("project_id","ordinal");--> statement-breakpoint
CREATE INDEX "project_decisions_project_idx" ON "project_decisions" USING btree ("project_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "project_memberships_uq" ON "project_memberships" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_status_events_project_idx" ON "project_status_events" USING btree ("project_id","at");--> statement-breakpoint
CREATE INDEX "songs_project_idx" ON "songs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "distribution_variants_asset_idx" ON "distribution_variants" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "distribution_variants_org_ready_idx" ON "distribution_variants" USING btree ("org_id","readiness");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_metrics_uq" ON "publication_metrics_snapshots" USING btree ("publication_id","snapshot_at");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_records_external_uq" ON "publication_records" USING btree ("org_id","social_account_id","external_post_id") WHERE "publication_records"."external_post_id" is not null;--> statement-breakpoint
CREATE INDEX "publication_records_org_state_idx" ON "publication_records" USING btree ("org_id","state");--> statement-breakpoint
CREATE INDEX "publication_records_planned_idx" ON "publication_records" USING btree ("org_id","planned_at");--> statement-breakpoint
CREATE INDEX "publication_records_variant_idx" ON "publication_records" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "publication_records_account_idx" ON "publication_records" USING btree ("social_account_id");--> statement-breakpoint
CREATE INDEX "publication_status_events_pub_idx" ON "publication_status_events" USING btree ("publication_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_targets_uq" ON "publication_targets" USING btree ("variant_id","social_account_id");--> statement-breakpoint
CREATE INDEX "publication_targets_account_idx" ON "publication_targets" USING btree ("social_account_id");--> statement-breakpoint
CREATE INDEX "publishing_schedules_planned_idx" ON "publishing_schedules" USING btree ("org_id","planned_at");--> statement-breakpoint
CREATE INDEX "publishing_schedules_pub_idx" ON "publishing_schedules" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "contacts_org_idx" ON "contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contacts_ext_org_idx" ON "contacts" USING btree ("external_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_threads_provider_uq" ON "conversation_threads" USING btree ("org_id","source","principal","provider_thread_id") WHERE "conversation_threads"."provider_thread_id" is not null;--> statement-breakpoint
CREATE INDEX "conversation_threads_state_idx" ON "conversation_threads" USING btree ("org_id","state");--> statement-breakpoint
CREATE INDEX "conversation_threads_triage_idx" ON "conversation_threads" USING btree ("org_id","triage_state");--> statement-breakpoint
CREATE INDEX "deal_deliverables_deal_idx" ON "deal_deliverables" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "deal_deliverables_due_idx" ON "deal_deliverables" USING btree ("org_id","due_at");--> statement-breakpoint
CREATE INDEX "deals_org_stage_idx" ON "deals" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "deals_due_idx" ON "deals" USING btree ("org_id","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_orgs_name_uq" ON "external_organizations" USING btree ("org_id",lower("name")) WHERE "external_organizations"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_rules_key_uq" ON "follow_up_rules" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_uq" ON "fx_rates" USING btree ("org_id","base_currency","quote_currency","rate_date");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_classifications_msg_uq" ON "inbound_classifications" USING btree ("message_id","algorithm");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_no_uq" ON "invoices" USING btree ("org_id","invoice_no");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("org_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_uq" ON "messages" USING btree ("org_id","source","principal","provider_msg_id") WHERE "messages"."provider_msg_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_checksum_uq" ON "messages" USING btree ("org_id","thread_id","raw_checksum");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_thread_uq" ON "opportunities" USING btree ("source_thread_id") WHERE "opportunities"."source_thread_id" is not null and "opportunities"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "opportunities_org_stage_idx" ON "opportunities" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_snapshots_uq" ON "analytics_snapshots" USING btree ("org_id",coalesce("social_account_id", '00000000-0000-0000-0000-000000000000'::uuid),"period","period_start","source");--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_uq" ON "api_idempotency_keys" USING btree ("org_id","actor_id","endpoint","key");--> statement-breakpoint
CREATE INDEX "audit_events_org_at_idx" ON "audit_events" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "audit_events_object_idx" ON "audit_events" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "background_jobs_status_idx" ON "background_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "background_jobs_type_idx" ON "background_jobs" USING btree ("type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_observations_uq" ON "goal_observations" USING btree ("goal_id","period_start");--> statement-breakpoint
CREATE INDEX "goals_org_idx" ON "goals" USING btree ("org_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_actions_dedupe_uq" ON "internal_actions" USING btree ("org_id","dedupe_key") WHERE "internal_actions"."dedupe_key" is not null and "internal_actions"."state" in ('OPEN','SNOOZED');--> statement-breakpoint
CREATE INDEX "internal_actions_org_state_due_idx" ON "internal_actions" USING btree ("org_id","state","due_at");--> statement-breakpoint
CREATE INDEX "internal_actions_source_idx" ON "internal_actions" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_uq" ON "notification_preferences" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("org_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("org_id","user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_states_hash_uq" ON "oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "outbox_state_idx" ON "outbox_events" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_uq" ON "settings_and_feature_flags" USING btree ("org_id","scope","key");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cursors_uq" ON "sync_cursors" USING btree ("connection_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "task_links_idem_uq" ON "task_links" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "task_links_action_integration_uq" ON "task_links" USING btree ("action_id","integration_id");--> statement-breakpoint
CREATE INDEX "task_links_state_idx" ON "task_links" USING btree ("org_id","sync_state","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_receipts_uq" ON "webhook_receipts" USING btree ("source","event_id");