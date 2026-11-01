CREATE TABLE IF NOT EXISTS h3_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  worker_id uuid REFERENCES gpu_workers(id) ON DELETE SET NULL,
  image_file_id uuid REFERENCES file_instances(id) ON DELETE SET NULL,
  image_upload_name text,
  image_upload_worker_id uuid REFERENCES gpu_workers(id) ON DELETE SET NULL,
  prompt text NOT NULL DEFAULT '',
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS h3_drafts_org_uq ON h3_drafts (org_id);
