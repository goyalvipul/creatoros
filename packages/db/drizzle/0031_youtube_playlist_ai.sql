ALTER TABLE publish_drafts ADD COLUMN IF NOT EXISTS playlist_ids text[] NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE publish_drafts ADD COLUMN IF NOT EXISTS ai_use text;--> statement-breakpoint
ALTER TABLE publish_drafts DROP CONSTRAINT IF EXISTS publish_drafts_ai_use_chk;--> statement-breakpoint
ALTER TABLE publish_drafts ADD CONSTRAINT publish_drafts_ai_use_chk CHECK (ai_use IS NULL OR ai_use IN ('YES', 'NO'));
