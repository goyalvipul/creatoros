ALTER TYPE "asset_kind" ADD VALUE IF NOT EXISTS 'PROJECT';--> statement-breakpoint
ALTER TABLE "logical_assets" ADD COLUMN IF NOT EXISTS "device_id" uuid;--> statement-breakpoint
ALTER TABLE "logical_assets" ADD COLUMN IF NOT EXISTS "folder_key" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "logical_assets" ADD CONSTRAINT "logical_assets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "logical_assets_folder_uq" ON "logical_assets" ("org_id","device_id","folder_key","kind") WHERE source = 'folder' AND device_id IS NOT NULL AND folder_key IS NOT NULL;
