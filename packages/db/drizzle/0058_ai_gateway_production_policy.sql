ALTER TABLE ai_gateway_connections ADD COLUMN production_policy jsonb;
--> statement-breakpoint
ALTER TABLE ai_gateway_requests ADD COLUMN policy_authorized boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX ai_gateway_policy_daily_idx ON ai_gateway_requests(org_id,operation,created_at) WHERE policy_authorized;
