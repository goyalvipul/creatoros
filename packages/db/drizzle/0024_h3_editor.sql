ALTER TABLE h3_drafts ADD COLUMN IF NOT EXISTS aspect_ratio text NOT NULL DEFAULT '9:16 (Portrait Widescreen)';
--> statement-breakpoint
ALTER TABLE h3_drafts ADD COLUMN IF NOT EXISTS megapixels double precision NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE h3_drafts ADD COLUMN IF NOT EXISTS audio_locked boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE h3_drafts ADD COLUMN IF NOT EXISTS share_audio boolean NOT NULL DEFAULT false;
