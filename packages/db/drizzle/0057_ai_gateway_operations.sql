ALTER TABLE ai_gateway_connections ADD COLUMN local_scopes text[], ADD COLUMN hosted_scopes text[];
--> statement-breakpoint
UPDATE ai_gateway_connections SET local_scopes=scopes,hosted_scopes=scopes;
--> statement-breakpoint
ALTER TABLE ai_gateway_connections ALTER COLUMN local_scopes SET NOT NULL, ALTER COLUMN hosted_scopes SET NOT NULL, ALTER COLUMN local_scopes SET DEFAULT ARRAY['projects.read','media.read']::text[], ALTER COLUMN hosted_scopes SET DEFAULT ARRAY['projects.read','media.read']::text[];
--> statement-breakpoint
CREATE TABLE ai_gateway_requests (
 id uuid PRIMARY KEY,
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 mode text NOT NULL CHECK (mode IN ('local','hosted')),
 credential_hash text NOT NULL,
 operation text NOT NULL,
 scope text NOT NULL,
 input jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','REJECTED')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 finished_at timestamptz
);
--> statement-breakpoint
CREATE INDEX ai_gateway_requests_org_idx ON ai_gateway_requests(org_id,created_at DESC);
