create table if not exists long_video_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  title text not null,
  status text not null default 'DRAFT',
  aspect text not null default '16:9',
  target_scene_ms integer not null default 10000,
  duration_ms integer,
  audio_path text,
  audio_name text,
  audio_mime text,
  sample_rate integer,
  channels integer,
  peaks jsonb not null default '[]'::jsonb,
  worker_id uuid,
  comfy_audio_name text,
  style text not null default 'Maximum realism',
  resolution text not null default '768P',
  fps integer not null default 30,
  batch_state text not null default 'off',
  export_status text,
  export_path text,
  export_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists long_video_projects_org_idx on long_video_projects (org_id, updated_at);

create table if not exists long_video_scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references long_video_projects(id) on delete cascade,
  position integer not null,
  start_ms integer not null,
  end_ms integer not null,
  label text not null default '',
  mode text not null default 'broll',
  prompt text not null default '',
  status text not null default 'DRAFT',
  job_id uuid,
  take_path text,
  outdated boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists long_video_scenes_project_idx on long_video_scenes (project_id, position);

create table if not exists long_video_refs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references long_video_projects(id) on delete cascade,
  scene_id uuid references long_video_scenes(id) on delete cascade,
  kind text not null default 'image',
  name text not null,
  path text not null,
  created_at timestamptz not null default now()
);
create index if not exists long_video_refs_project_idx on long_video_refs (project_id);
