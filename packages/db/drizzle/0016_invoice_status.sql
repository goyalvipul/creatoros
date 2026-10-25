ALTER TYPE "invoice_status" ADD VALUE IF NOT EXISTS 'SENT';--> statement-breakpoint
ALTER TYPE "invoice_status" ADD VALUE IF NOT EXISTS 'CONFIRMED';
