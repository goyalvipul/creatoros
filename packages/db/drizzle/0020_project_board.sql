-- Production board: Draft, In-Progress, Ready, Published, Archived.
CREATE TYPE "project_stage_new" AS ENUM('DRAFT', 'IN_PROGRESS', 'READY', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint

ALTER TABLE "creative_projects" ALTER COLUMN "stage" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "creative_projects"
  ALTER COLUMN "stage" TYPE "project_stage_new"
  USING (
    CASE "stage"::text
      WHEN 'DRAFT' THEN 'DRAFT'
      WHEN 'READY' THEN 'READY'
      WHEN 'ARCHIVED' THEN 'ARCHIVED'
      WHEN 'DISTRIBUTING' THEN 'PUBLISHED'
      ELSE 'IN_PROGRESS'
    END
  )::"project_stage_new";--> statement-breakpoint

ALTER TABLE "project_status_events"
  ALTER COLUMN "from_stage" TYPE "project_stage_new"
  USING (
    CASE
      WHEN "from_stage" IS NULL THEN NULL
      WHEN "from_stage"::text = 'DRAFT' THEN 'DRAFT'
      WHEN "from_stage"::text = 'READY' THEN 'READY'
      WHEN "from_stage"::text = 'ARCHIVED' THEN 'ARCHIVED'
      WHEN "from_stage"::text = 'DISTRIBUTING' THEN 'PUBLISHED'
      ELSE 'IN_PROGRESS'
    END
  )::"project_stage_new";--> statement-breakpoint

ALTER TABLE "project_status_events"
  ALTER COLUMN "to_stage" TYPE "project_stage_new"
  USING (
    CASE "to_stage"::text
      WHEN 'DRAFT' THEN 'DRAFT'
      WHEN 'READY' THEN 'READY'
      WHEN 'ARCHIVED' THEN 'ARCHIVED'
      WHEN 'DISTRIBUTING' THEN 'PUBLISHED'
      ELSE 'IN_PROGRESS'
    END
  )::"project_stage_new";--> statement-breakpoint

DROP TYPE "project_stage";--> statement-breakpoint
ALTER TYPE "project_stage_new" RENAME TO "project_stage";--> statement-breakpoint
ALTER TABLE "creative_projects" ALTER COLUMN "stage" SET DEFAULT 'DRAFT'::"project_stage";--> statement-breakpoint

UPDATE "project_checklist_items"
SET "stage" = CASE "stage"
  WHEN 'APPROVED' THEN 'IN_PROGRESS'
  WHEN 'GENERATING' THEN 'IN_PROGRESS'
  WHEN 'EDITING' THEN 'IN_PROGRESS'
  WHEN 'QA' THEN 'READY'
  WHEN 'DISTRIBUTING' THEN 'PUBLISHED'
  ELSE "stage"
END
WHERE "stage" IN ('APPROVED', 'GENERATING', 'EDITING', 'QA', 'DISTRIBUTING');
