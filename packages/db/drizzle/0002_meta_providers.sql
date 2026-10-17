-- Meta integrations: Instagram Login, Facebook Pages and Threads become their own providers.
-- The legacy 'meta' value is kept so existing connections keep working.
ALTER TYPE "public"."provider" ADD VALUE IF NOT EXISTS 'instagram';
--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE IF NOT EXISTS 'facebook';
--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE IF NOT EXISTS 'threads';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"dedupe_key" text NOT NULL,
	"object_type" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_webhook_events_dedupe_uq" ON "provider_webhook_events" USING btree ("provider","dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_webhook_events_status_idx" ON "provider_webhook_events" USING btree ("status","received_at");
