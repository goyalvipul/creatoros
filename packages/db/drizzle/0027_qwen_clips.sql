ALTER TABLE "qwen_drafts" ADD COLUMN IF NOT EXISTS "builtin_clip" text DEFAULT 'mehakdeepvoice.wav' NOT NULL;
