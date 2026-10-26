CREATE TABLE IF NOT EXISTS gpu_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  label text NOT NULL,
  base_url text NOT NULL,
  role text NOT NULL DEFAULT 'secondary',
  enabled boolean NOT NULL DEFAULT true,
  expected_vram_gb integer,
  last_checked_at timestamptz,
  last_ok boolean,
  last_error text,
  reported_vram_gb double precision,
  comfy_version text,
  device_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gpu_workers_role_chk CHECK (role IN ('primary', 'secondary'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS gpu_workers_org_url_uq ON gpu_workers (org_id, base_url);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS gpu_workers_org_idx ON gpu_workers (org_id);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ltx_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid REFERENCES creative_projects(id) ON DELETE SET NULL,
  worker_id uuid REFERENCES gpu_workers(id) ON DELETE SET NULL,
  image_file_id uuid REFERENCES file_instances(id) ON DELETE SET NULL,
  audio_file_id uuid REFERENCES file_instances(id) ON DELETE SET NULL,
  audio_start_sec double precision NOT NULL DEFAULT 0,
  duration_sec double precision NOT NULL DEFAULT 20,
  prompt text NOT NULL DEFAULT '',
  negative_prompt text NOT NULL DEFAULT '',
  width integer NOT NULL DEFAULT 576,
  height integer NOT NULL DEFAULT 1024,
  fps integer NOT NULL DEFAULT 30,
  lora_strength double precision NOT NULL DEFAULT 0.8,
  want_upscale boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ltx_drafts_org_uq ON ltx_drafts (org_id);
