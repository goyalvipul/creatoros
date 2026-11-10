create table if not exists ai_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  openai_enabled boolean not null default true,
  gemini_enabled boolean not null default true,
  prompt_model text not null default 'gpt-5-mini',
  image_model text not null default 'gemini-nano-banana-2.1',
  video_model text not null default 'gemini-2.5-flash',
  metadata_model text not null default 'gemini-2.5-flash',
  image_aspect text not null default '16:9',
  image_size text not null default '1K',
  tone text not null default 'cinematic, specific, and natural',
  timeout_sec integer not null default 90,
  max_attempts integer not null default 2,
  daily_prompt_limit integer not null default 40,
  monthly_prompt_limit integer not null default 400,
  daily_image_limit integer not null default 4,
  monthly_image_limit integer not null default 30,
  daily_video_limit integer not null default 4,
  monthly_video_limit integer not null default 20,
  daily_metadata_limit integer not null default 20,
  monthly_metadata_limit integer not null default 200,
  updated_at timestamptz not null default now()
);

create table if not exists ai_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade,
  name text not null default '',
  niche text not null default '',
  languages text not null default '',
  tone text not null default '',
  voice text not null default '',
  themes text not null default '',
  visual_notes text not null default '',
  avoid text not null default '',
  hashtags text not null default '',
  links text not null default '',
  disclosure text not null default '',
  character_name text not null default '',
  character_notes text not null default '',
  reference_file_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists ai_profiles_org_brand_uq on ai_profiles (org_id, brand_id);

create table if not exists ai_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid,
  brand_id uuid,
  task text not null,
  provider text not null,
  model text not null,
  status text not null default 'QUEUED',
  idempotency_key text,
  target_type text,
  target_id text,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  usage jsonb,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists ai_jobs_org_status_idx on ai_jobs (org_id, status, created_at);
create unique index if not exists ai_jobs_idem_uq on ai_jobs (org_id, idempotency_key) where idempotency_key is not null;

create table if not exists ai_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid,
  target_type text not null,
  target_id text not null,
  task text not null,
  provider text not null,
  model text not null,
  image_prompt text not null default '',
  video_prompt text not null default '',
  fields jsonb not null default '{}'::jsonb,
  applied boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ai_prompt_versions_target_idx on ai_prompt_versions (org_id, target_type, target_id, created_at);

create table if not exists ai_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid,
  scene_id uuid,
  project_id uuid,
  kind text not null,
  path text not null,
  mime text not null,
  width integer,
  height integer,
  bytes integer not null default 0,
  prompt text not null default '',
  model text not null default '',
  reference_ids jsonb not null default '[]'::jsonb,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ai_assets_scene_idx on ai_assets (org_id, scene_id, created_at);

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid,
  provider text not null,
  task_group text not null,
  status text not null,
  images integer not null default 0,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_org_group_idx on ai_usage (org_id, task_group, created_at);
