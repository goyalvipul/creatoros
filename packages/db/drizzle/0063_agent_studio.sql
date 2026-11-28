-- Additive: 0062 may already be deployed. Never rewrite that migration.
ALTER TABLE ai_gateway_connections ADD COLUMN agent_exclusive boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE agent_definitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 brand_id uuid NOT NULL REFERENCES brands(id),
 name text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1,
 config jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_one_enabled_creator ON agent_definitions(org_id,brand_id) WHERE enabled;
--> statement-breakpoint
CREATE TABLE agent_definition_versions (
 agent_id uuid NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 config jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(agent_id,revision)
);
--> statement-breakpoint
CREATE TABLE agent_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agent_id uuid NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 brand_id uuid NOT NULL REFERENCES brands(id),
 slot text NOT NULL,
 revision integer NOT NULL,
 snapshot jsonb NOT NULL,
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','PAUSED','STOPPED','BLOCKED','FAILED','COMPLETED')),
 stage integer NOT NULL DEFAULT 0 CHECK(stage>=0),
 project_id uuid REFERENCES creative_projects(id),
 production_run_id uuid REFERENCES production_runs(id),
 plan_id uuid,
 job_id uuid,
 file_id uuid,
 detail text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agent_id,slot),
 FOREIGN KEY(agent_id,revision) REFERENCES agent_definition_versions(agent_id,revision)
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_one_active_run ON agent_runs(agent_id) WHERE state IN ('ACTIVE','PAUSED');
--> statement-breakpoint
CREATE INDEX agent_runs_due ON agent_runs(updated_at) WHERE state='ACTIVE';
--> statement-breakpoint
ALTER TABLE agent_tasks ADD COLUMN agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE agent_tasks ADD COLUMN stage_key text;
--> statement-breakpoint
CREATE UNIQUE INDEX agent_run_stage_task ON agent_tasks(agent_run_id,stage_key) WHERE agent_run_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE agent_tasks DROP CONSTRAINT agent_tasks_task_type_check;
--> statement-breakpoint
ALTER TABLE agent_tasks ADD CONSTRAINT agent_tasks_task_type_check CHECK(task_type IN ('CONTENT_STRATEGY','SCRIPT_GENERATION','IMAGE_GENERATION','RESEARCH','PRODUCTION_PLANNING','VIDEO_REVIEW','SEO_GENERATION'));

--> statement-breakpoint
ALTER TABLE agent_tasks ADD COLUMN frames_retrieved boolean NOT NULL DEFAULT false;
