-- Custom migration: extensions, search indexes and data-integrity CHECK constraints.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS file_instances_display_path_trgm ON file_instances USING gin (display_path gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS file_instances_file_name_trgm ON file_instances USING gin (file_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS logical_assets_title_trgm ON logical_assets USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creative_projects_title_trgm ON creative_projects USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ideas_title_trgm ON ideas USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS publication_records_title_trgm ON publication_records USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS deals_title_trgm ON deals USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_name_trgm ON contacts USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS external_orgs_name_trgm ON external_organizations USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_subject_trgm ON messages USING gin (subject gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS brands_name_trgm ON brands USING gin (name gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount_minor > 0);
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_amount_nonneg CHECK (amount_minor >= 0 AND paid_total_minor >= 0);
--> statement-breakpoint
ALTER TABLE production_scenes ADD CONSTRAINT scenes_timecode_order CHECK (
  timecode_start_ms IS NULL OR timecode_end_ms IS NULL OR timecode_end_ms >= timecode_start_ms
);
--> statement-breakpoint
ALTER TABLE file_instances ADD CONSTRAINT file_instances_size_nonneg CHECK (size >= 0);
--> statement-breakpoint
ALTER TABLE duplicate_candidates ADD CONSTRAINT duplicate_candidates_order CHECK (media_a_id < media_b_id);
--> statement-breakpoint
ALTER TABLE storage_roots ADD CONSTRAINT storage_roots_read_only CHECK (read_only = true);
--> statement-breakpoint
ALTER TABLE media_objects ADD CONSTRAINT media_objects_hash_len CHECK (length(exact_hash) = 64);
