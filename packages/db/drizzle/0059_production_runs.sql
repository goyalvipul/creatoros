CREATE TABLE production_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id),
  local_day date NOT NULL,
  target integer NOT NULL CHECK(target BETWEEN 1 AND 2),
  state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','PAUSED','STOPPED')),
  planning_state text NOT NULL DEFAULT 'RESEARCHING' CHECK(planning_state IN ('RESEARCHING','PLANNED','BLOCKED','FAILED')),
  planning_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,brand_id,local_day)
);
--> statement-breakpoint
CREATE TABLE production_run_events (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  stage text NOT NULL,
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX production_run_events_run_idx ON production_run_events(run_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX production_run_project_job_uq ON generation_jobs(org_id,(settings->>'productionRunId'),project_id)
 WHERE provider='comfyui-h3' AND settings->>'productionRunId' IS NOT NULL AND project_id IS NOT NULL;
