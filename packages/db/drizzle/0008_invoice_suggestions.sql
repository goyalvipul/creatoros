CREATE TABLE IF NOT EXISTS "invoice_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"message_id" uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
	"thread_id" uuid NOT NULL REFERENCES "conversation_threads"("id") ON DELETE CASCADE,
	"connection_id" uuid REFERENCES "provider_connections"("id") ON DELETE SET NULL,
	"invoice_no" text,
	"amount_minor" bigint,
	"currency" text,
	"due_at" timestamp with time zone,
	"direction" text DEFAULT 'UNKNOWN' NOT NULL,
	"counterparty" text,
	"subject" text,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'SUGGESTED' NOT NULL,
	"accepted_invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
	"accepted_expense_id" uuid REFERENCES "expenses"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_suggestions_message_uq" ON "invoice_suggestions" ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_suggestions_org_status_idx" ON "invoice_suggestions" ("org_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_suggestions_thread_idx" ON "invoice_suggestions" ("thread_id");
