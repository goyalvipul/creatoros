create table if not exists autogen_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  project_id uuid references creative_projects(id) on delete set null,
  title text not null,
  prompt text not null default '',
  status text not null default 'RUNNING',
  audio_file_id uuid references file_instances(id) on delete set null,
  image_file_id uuid references file_instances(id) on delete set null,
  audio_upload_name text,
  audio_upload_worker_id uuid references gpu_workers(id) on delete set null,
  image_upload_name text,
  image_upload_worker_id uuid references gpu_workers(id) on delete set null,
  audio_length_sec double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists autogen_runs_org_idx on autogen_runs (org_id, created_at);

create table if not exists autogen_clips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references autogen_runs(id) on delete cascade,
  ordinal integer not null,
  start_sec double precision not null,
  duration_sec double precision,
  status text not null default 'WAITING',
  attempt integer not null default 0,
  exclude_worker_id uuid references gpu_workers(id) on delete set null,
  worker_id uuid references gpu_workers(id) on delete set null,
  worker_label text,
  job_id uuid references generation_jobs(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists autogen_clips_run_idx on autogen_clips (run_id, ordinal);
create index if not exists autogen_clips_status_idx on autogen_clips (status);
