DO $$ BEGIN
  CREATE TYPE file_operation_kind AS ENUM ('RENAME', 'MOVE', 'DELETE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE file_operation_status AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS file_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  file_instance_id uuid NOT NULL REFERENCES file_instances(id),
  kind file_operation_kind NOT NULL,
  from_path text NOT NULL,
  to_path text,
  size_bytes bigint NOT NULL DEFAULT 0,
  status file_operation_status NOT NULL DEFAULT 'PENDING',
  error text,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS file_operations_open_uq ON file_operations (file_instance_id) WHERE status IN ('PENDING', 'RUNNING');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS file_operations_device_status_idx ON file_operations (device_id, status);
