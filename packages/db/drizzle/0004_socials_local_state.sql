-- Local (CreatorOS-only) conversation state. None of these change anything on the social platform.
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "starred" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "archived_local" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "internal_notes" text;
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "follow_up_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_threads_social_idx" ON "conversation_threads" ("org_id","provider_connection_id","archived_local","state");
