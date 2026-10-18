ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "reply_category" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_threads_reply_category_idx" ON "conversation_threads" ("org_id","reply_category");
