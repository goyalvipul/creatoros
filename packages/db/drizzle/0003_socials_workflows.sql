-- Socials unified inbox + workflows engine.
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "participant_id" text;
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "participant_name" text;
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'DM' NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "labels" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'NORMAL' NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN IF NOT EXISTS "opted_out" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"description" text,
	"mode" text DEFAULT 'DRAFT_ONLY' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"connection_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"active_version_id" uuid,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"tested_at" timestamp with time zone,
	"tested_version" integer,
	"pause_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_org_status_idx" ON "workflows" ("org_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
	"version" integer NOT NULL,
	"mode" text NOT NULL,
	"definition" jsonb NOT NULL,
	"note" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_versions_uq" ON "workflow_versions" ("workflow_id","version");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"thread_id" uuid NOT NULL REFERENCES "conversation_threads"("id") ON DELETE CASCADE,
	"connection_id" uuid NOT NULL REFERENCES "provider_connections"("id") ON DELETE RESTRICT,
	"provider_account_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" text DEFAULT 'DM' NOT NULL,
	"body" text NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"request_id" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"source" text DEFAULT 'USER' NOT NULL,
	"execution_id" uuid,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_outbound_request_uq" ON "social_outbound_messages" ("org_id","request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_outbound_thread_idx" ON "social_outbound_messages" ("thread_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_outbound_conn_state_idx" ON "social_outbound_messages" ("connection_id","state","sent_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
	"version_id" uuid NOT NULL REFERENCES "workflow_versions"("id") ON DELETE RESTRICT,
	"version_number" integer NOT NULL,
	"event_key" text NOT NULL,
	"is_simulation" boolean DEFAULT false NOT NULL,
	"connection_id" uuid REFERENCES "provider_connections"("id") ON DELETE SET NULL,
	"thread_id" uuid REFERENCES "conversation_threads"("id") ON DELETE SET NULL,
	"message_id" uuid,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"outcome" text,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_executions_event_uq" ON "workflow_executions" ("workflow_id","event_key") WHERE "is_simulation" = false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_executions_wf_idx" ON "workflow_executions" ("workflow_id","started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_executions_org_status_idx" ON "workflow_executions" ("org_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"execution_id" uuid NOT NULL REFERENCES "workflow_executions"("id") ON DELETE CASCADE,
	"workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
	"thread_id" uuid NOT NULL REFERENCES "conversation_threads"("id") ON DELETE CASCADE,
	"connection_id" uuid NOT NULL REFERENCES "provider_connections"("id") ON DELETE RESTRICT,
	"recipient_id" text NOT NULL,
	"kind" text DEFAULT 'DM' NOT NULL,
	"proposed_text" text NOT NULL,
	"final_text" text,
	"reason" text,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"decided_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"outbound_id" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_approvals_state_idx" ON "workflow_approvals" ("org_id","state","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_approvals_exec_uq" ON "workflow_approvals" ("execution_id");
