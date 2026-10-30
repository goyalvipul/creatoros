ALTER TABLE ltx_drafts ADD COLUMN IF NOT EXISTS lora_name text NOT NULL DEFAULT 'mehaklora-ltx.safetensors';--> statement-breakpoint
ALTER TABLE ltx_drafts ADD COLUMN IF NOT EXISTS upscale_width integer NOT NULL DEFAULT 1152;--> statement-breakpoint
ALTER TABLE ltx_drafts ADD COLUMN IF NOT EXISTS upscale_height integer NOT NULL DEFAULT 2048;--> statement-breakpoint
ALTER TABLE ltx_drafts ADD COLUMN IF NOT EXISTS image_upload_name text;--> statement-breakpoint
ALTER TABLE ltx_drafts ADD COLUMN IF NOT EXISTS image_upload_worker_id uuid REFERENCES gpu_workers(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE ltx_drafts ADD COLUMN IF NOT EXISTS audio_upload_name text;--> statement-breakpoint
ALTER TABLE ltx_drafts ADD COLUMN IF NOT EXISTS audio_upload_worker_id uuid REFERENCES gpu_workers(id) ON DELETE SET NULL;
