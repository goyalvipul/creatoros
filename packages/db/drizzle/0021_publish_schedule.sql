ALTER TABLE "publish_drafts" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "publish_drafts_due_idx" ON "publish_drafts" ("scheduled_at") WHERE "upload_state" = 'SCHEDULED';
