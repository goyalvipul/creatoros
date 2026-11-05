DO $$ BEGIN
  CREATE TYPE video_edit_status AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE video_edit_mode AS ENUM ('ACCURATE', 'FAST');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS video_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  source_file_instance_id uuid NOT NULL REFERENCES file_instances(id),
  project_id uuid REFERENCES creative_projects(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES distribution_variants(id) ON DELETE SET NULL,
  mode video_edit_mode NOT NULL DEFAULT 'ACCURATE',
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  output_display_path text NOT NULL,
  output_canonical_path text NOT NULL,
  output_root_id uuid NOT NULL REFERENCES storage_roots(id),
  output_file_instance_id uuid REFERENCES file_instances(id),
  status video_edit_status NOT NULL DEFAULT 'PENDING',
  progress_pct integer NOT NULL DEFAULT 0,
  error text,
  source_probe jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_probe jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS video_edits_device_status_idx ON video_edits (device_id, status);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS video_edits_open_path_uq
  ON video_edits (output_root_id, output_canonical_path)
  WHERE status IN ('PENDING', 'RUNNING');
