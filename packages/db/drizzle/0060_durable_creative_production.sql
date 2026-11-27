CREATE TABLE local_image_jobs (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id),
  run_id uuid REFERENCES production_runs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES gpu_workers(id),
  root_id uuid NOT NULL REFERENCES storage_roots(id),
  state text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','SUBMITTING','RENDERING','IMPORTING','COMPLETE','FAILED','UNCERTAIN','CANCELLED')),
  payload jsonb NOT NULL,
  prompt_id text,
  file_id uuid REFERENCES file_instances(id),
  output jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX local_image_jobs_pending_idx ON local_image_jobs(state,updated_at);
--> statement-breakpoint
CREATE INDEX local_image_jobs_worker_idx ON local_image_jobs(org_id,worker_id,state);
--> statement-breakpoint
CREATE TABLE production_plans (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id),
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'PREPARING' CHECK (state IN ('PREPARING','WAIT_IMAGES','QUEUE_VIDEO','WAIT_VIDEO','QUALITY','REGENERATE','PASSED','REVIEW','FAILED','STOPPED')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  job_id uuid REFERENCES generation_jobs(id),
  quality jsonb,
  detail text,
  lease uuid,
  lease_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,run_id,project_id)
);
--> statement-breakpoint
CREATE INDEX production_plans_pending_idx ON production_plans(state,updated_at);
--> statement-breakpoint
DROP INDEX production_run_project_job_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX production_run_project_job_uq ON generation_jobs(org_id,(settings->>'productionRunId'),project_id)
 WHERE provider='comfyui-h3' AND settings->>'productionRunId' IS NOT NULL AND project_id IS NOT NULL
 AND coalesce(settings->>'productionSuperseded','false')<>'true';
