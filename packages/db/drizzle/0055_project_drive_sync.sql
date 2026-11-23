CREATE TABLE IF NOT EXISTS project_drive_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
  folder_id text,
  folder_name text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  selected_item_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  total integer NOT NULL DEFAULT 0,
  completed integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_drive_syncs_project_idx ON project_drive_syncs(org_id, project_id, created_at);
