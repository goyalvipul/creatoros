CREATE TABLE IF NOT EXISTS "windows_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "label" text NOT NULL,
  "task_name" text NOT NULL,
  "status" text DEFAULT 'UNKNOWN' NOT NULL,
  "detail" text,
  "checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "windows_tasks" ADD CONSTRAINT "windows_tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "windows_tasks" ADD CONSTRAINT "windows_tasks_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "windows_tasks_device_name_uq" ON "windows_tasks" ("device_id","task_name");
CREATE INDEX IF NOT EXISTS "windows_tasks_org_idx" ON "windows_tasks" ("org_id");

CREATE TABLE IF NOT EXISTS "windows_task_restarts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "error" text,
  "requested_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
DO $$ BEGIN
  ALTER TABLE "windows_task_restarts" ADD CONSTRAINT "windows_task_restarts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "windows_task_restarts" ADD CONSTRAINT "windows_task_restarts_task_id_windows_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "windows_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "windows_task_restarts" ADD CONSTRAINT "windows_task_restarts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "windows_task_restarts" ADD CONSTRAINT "windows_task_restarts_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "windows_task_restarts_device_idx" ON "windows_task_restarts" ("device_id","status");
