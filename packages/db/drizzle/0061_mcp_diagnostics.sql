CREATE TABLE mcp_diagnostic_subscriptions (
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
CREATE TABLE mcp_diagnostic_requests (
  id uuid PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES mcp_diagnostic_subscriptions(id),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  credential_hash text NOT NULL,
  principal text NOT NULL,
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  error_code text,
  http_status integer,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX mcp_diagnostic_pending_idx ON mcp_diagnostic_requests (next_attempt_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL AND completed_at IS NULL;
--> statement-breakpoint
CREATE INDEX mcp_diagnostic_history_idx ON mcp_diagnostic_requests (org_id, owner_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE mcp_diagnostic_site_calls (
  nonce uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE mcp_diagnostic_verification_errors (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, owner_id)
);
