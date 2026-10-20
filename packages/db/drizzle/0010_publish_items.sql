ALTER TABLE "publication_records" ADD COLUMN IF NOT EXISTS "file_instance_id" uuid REFERENCES "file_instances"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publication_records_file_idx" ON "publication_records" ("file_instance_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publish_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"variant_id" uuid NOT NULL REFERENCES "distribution_variants"("id") ON DELETE CASCADE,
	"file_instance_id" uuid NOT NULL REFERENCES "file_instances"("id") ON DELETE RESTRICT,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "publish_items_uq" ON "publish_items" ("variant_id","file_instance_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publish_items_org_idx" ON "publish_items" ("org_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publish_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"item_id" uuid NOT NULL REFERENCES "publish_items"("id") ON DELETE CASCADE,
	"social_account_id" uuid NOT NULL REFERENCES "social_accounts"("id"),
	"title" text,
	"caption" text,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"privacy" text,
	"request_id" text,
	"upload_state" text DEFAULT 'DRAFT' NOT NULL,
	"publication_id" uuid REFERENCES "publication_records"("id") ON DELETE SET NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "publish_drafts_item_account_uq" ON "publish_drafts" ("item_id","social_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "publish_drafts_request_uq" ON "publish_drafts" ("org_id","request_id") WHERE "request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publish_drafts_state_idx" ON "publish_drafts" ("org_id","upload_state");
