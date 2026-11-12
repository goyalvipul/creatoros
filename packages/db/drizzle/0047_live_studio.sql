CREATE TABLE "stream_machines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "os" text DEFAULT 'linux' NOT NULL,
  "token_hash" text NOT NULL,
  "ffmpeg" text,
  "encoders" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "free_bytes" bigint,
  "total_bytes" bigint,
  "roots" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "browse_path" text,
  "browse_listing" jsonb,
  "current_session_id" uuid,
  "last_seen_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stream_machines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stream_machines_token_uq" ON "stream_machines" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "stream_machines_org_idx" ON "stream_machines" USING btree ("org_id");
--> statement-breakpoint
CREATE TABLE "live_playlists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "name" text NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "live_playlists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "live_playlists_org_idx" ON "live_playlists" USING btree ("org_id");
--> statement-breakpoint
CREATE TABLE "live_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "relative_path" text,
  "byte_size" bigint NOT NULL,
  "sha256" text NOT NULL,
  "mime" text DEFAULT 'video/mp4' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "live_uploads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "live_uploads_org_idx" ON "live_uploads" USING btree ("org_id");
--> statement-breakpoint
CREATE TABLE "live_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "user_id" uuid,
  "playlist_id" uuid,
  "machine_id" uuid NOT NULL,
  "social_account_id" uuid,
  "title" text NOT NULL,
  "playlist_name" text,
  "status" text DEFAULT 'PREPARING' NOT NULL,
  "stop_reason" text,
  "error" text,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "playlist_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "youtube_broadcast_id" text,
  "youtube_stream_id" text,
  "watch_url" text,
  "ingest_secret" text,
  "youtube_bound" boolean DEFAULT false NOT NULL,
  "metadata_applied" boolean DEFAULT false NOT NULL,
  "policy_notify_ms" integer,
  "policy_stop_ms" integer NOT NULL,
  "job_created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "preparation_started_at" timestamp with time zone,
  "encoder_started_at" timestamp with time zone,
  "first_ingest_at" timestamp with time zone,
  "youtube_actual_start_at" timestamp with time zone,
  "youtube_actual_end_at" timestamp with time zone,
  "notify_at" timestamp with time zone,
  "auto_stop_at" timestamp with time zone,
  "ingest_safety_at" timestamp with time zone,
  "encoder_stopped_at" timestamp with time zone,
  "last_heartbeat_at" timestamp with time zone,
  "notified_at" timestamp with time zone,
  "ended_notified_at" timestamp with time zone,
  "replay_notified_at" timestamp with time zone,
  "replay_status" text,
  "replay_detail" text,
  "next_verify_at" timestamp with time zone,
  "youtube_checked_at" timestamp with time zone,
  "verified_live_ms" integer DEFAULT 0 NOT NULL,
  "verified_at" timestamp with time zone,
  "progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "log_excerpt" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "live_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "live_sessions_playlist_id_live_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."live_playlists"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "live_sessions_machine_id_stream_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."stream_machines"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "live_sessions_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "live_sessions_org_idx" ON "live_sessions" USING btree ("org_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "live_sessions_one_active_machine" ON "live_sessions" USING btree ("machine_id") WHERE status in ('PREPARING','CREATING','CONNECTING','LIVE','INTERRUPTED','STOPPING');
--> statement-breakpoint
CREATE UNIQUE INDEX "live_sessions_one_active_account" ON "live_sessions" USING btree ("social_account_id") WHERE social_account_id is not null and status in ('PREPARING','CREATING','CONNECTING','LIVE','INTERRUPTED','STOPPING');
