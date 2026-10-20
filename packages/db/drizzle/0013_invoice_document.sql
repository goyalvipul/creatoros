ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "bill_from" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "bill_to" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "bank_details" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "ordinal" integer NOT NULL,
  "description" text NOT NULL,
  "quantity" numeric(12, 4) NOT NULL,
  "unit_price_minor" bigint NOT NULL,
  "tax_percent" numeric(7, 4) DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_lines_invoice_idx" ON "invoice_lines" ("invoice_id");
