CREATE TABLE IF NOT EXISTS qwen_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  worker_id uuid REFERENCES gpu_workers(id) ON DELETE SET NULL,
  audio_file_id uuid REFERENCES file_instances(id) ON DELETE SET NULL,
  audio_upload_name text,
  audio_upload_worker_id uuid REFERENCES gpu_workers(id) ON DELETE SET NULL,
  use_builtin boolean NOT NULL DEFAULT true,
  reference_text text NOT NULL DEFAULT '',
  target_text text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS qwen_drafts_org_uq ON qwen_drafts (org_id);
