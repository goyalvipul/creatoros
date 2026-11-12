ALTER TABLE "long_video_projects" ADD COLUMN "creative_project_id" uuid;
--> statement-breakpoint
ALTER TABLE "long_video_projects" ADD CONSTRAINT "long_video_projects_creative_project_id_creative_projects_id_fk" FOREIGN KEY ("creative_project_id") REFERENCES "public"."creative_projects"("id") ON DELETE set null ON UPDATE no action;
