ALTER TABLE "live_sessions" ALTER COLUMN "machine_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "live_sessions" DROP CONSTRAINT "live_sessions_machine_id_stream_machines_id_fk";
--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_machine_id_stream_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."stream_machines"("id") ON DELETE set null ON UPDATE no action;
