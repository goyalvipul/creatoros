CREATE TABLE IF NOT EXISTS "social_media_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"connection_id" uuid NOT NULL REFERENCES "provider_connections"("id") ON DELETE CASCADE,
	"provider_media_id" text NOT NULL,
	"media_type" text,
	"caption" text,
	"permalink" text,
	"thumbnail_url" text,
	"posted_at" timestamp with time zone,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"comments_synced_count" integer,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_media_items_uq" ON "social_media_items" ("connection_id","provider_media_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_media_items_posted_idx" ON "social_media_items" ("org_id","connection_id","posted_at");
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "provider_media_id" text;
