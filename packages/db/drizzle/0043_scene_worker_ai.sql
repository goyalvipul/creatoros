ALTER TABLE "ai_settings" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "long_video_projects" ADD COLUMN "comfy_audio_worker_id" uuid;
--> statement-breakpoint
ALTER TABLE "long_video_scenes" ADD COLUMN "worker_id" uuid;
