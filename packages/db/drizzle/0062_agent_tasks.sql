-- Agent tasks are isolated from the proven diagnostic subscription path.
CREATE TABLE mcp_agent_subscriptions (
  id text PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_hash text NOT NULL,
  principal text NOT NULL,
  callback_hash text NOT NULL,
  callback_enc text,
  secret_enc text,
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
--> statement-breakpoint
CREATE TABLE agent_tasks (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id text NOT NULL REFERENCES mcp_agent_subscriptions(id),
  credential_hash text NOT NULL,
  principal text NOT NULL,
  brand_id uuid NOT NULL REFERENCES brands(id),
  project_id uuid REFERENCES creative_projects(id),
  task_type text NOT NULL CHECK (task_type IN ('CONTENT_STRATEGY','SCRIPT_GENERATION','IMAGE_GENERATION')),
  input jsonb NOT NULL,
  state text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','DISPATCHED','DELIVERED','CLAIMED','RUNNING','COMPLETED','FAILED','TIMED_OUT','CANCELLED','BLOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  delivered_at timestamptz,
  claimed_at timestamptz,
  lease_until timestamptz,
  claim_hash text,
  completed_at timestamptz,
  terminal_at timestamptz,
  result jsonb,
  progress text,
  error_code text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  upload_request_id uuid UNIQUE
);
--> statement-breakpoint
CREATE INDEX agent_tasks_dispatch_idx ON agent_tasks (next_attempt_at)
  WHERE state IN ('QUEUED','DISPATCHED');
--> statement-breakpoint
CREATE INDEX agent_tasks_org_history_idx ON agent_tasks(org_id, owner_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX agent_tasks_lease_idx ON agent_tasks(lease_until)
  WHERE state IN ('CLAIMED','RUNNING');
