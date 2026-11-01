ALTER TABLE "h3_drafts" ADD COLUMN IF NOT EXISTS "project_id" uuid;
DO $$ BEGIN
  ALTER TABLE "h3_drafts" ADD CONSTRAINT "h3_drafts_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "creative_projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
