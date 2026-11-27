CREATE TABLE production_plans (
 id uuid PRIMARY KEY REFERENCES ai_gateway_requests(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
 brand_id uuid NOT NULL REFERENCES brands(id),
 state text NOT NULL DEFAULT 'WAITING' CHECK(state IN ('WAITING','SUBMITTED','BLOCKED','UNCERTAIN','STOPPED')),
 plan jsonb NOT NULL,
 assets jsonb NOT NULL DEFAULT '[]'::jsonb,
 job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
 detail text,
 lease uuid,
 lease_at timestamptz,
 step text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,run_id,project_id)
);
--> statement-breakpoint
CREATE INDEX production_plans_queue_idx ON production_plans(state,updated_at);
