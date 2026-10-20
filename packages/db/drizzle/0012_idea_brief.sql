ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "song_title" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "song_file_id" uuid REFERENCES "file_instances"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "concept_detail" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "competitor" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "hook" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "narrative" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "distribution_plan" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "archived_from" "idea_status";--> statement-breakpoint
ALTER TABLE "creative_projects" ADD COLUMN IF NOT EXISTS "audience" text;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD COLUMN IF NOT EXISTS "song_title" text;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD COLUMN IF NOT EXISTS "song_file_id" uuid REFERENCES "file_instances"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD COLUMN IF NOT EXISTS "concept_detail" text;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD COLUMN IF NOT EXISTS "competitor" text;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD COLUMN IF NOT EXISTS "hook" text;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD COLUMN IF NOT EXISTS "narrative" text;--> statement-breakpoint
ALTER TABLE "creative_projects" ADD COLUMN IF NOT EXISTS "distribution_plan" text;
