alter table organizations add column if not exists cover_path text;

create table if not exists daily_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  local_date text not null,
  capacity_minutes integer not null default 180,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists daily_plans_user_day_uq on daily_plans (org_id, user_id, local_date);

create table if not exists daily_plan_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  plan_id uuid not null references daily_plans(id) on delete cascade,
  action_id uuid not null references internal_actions(id) on delete cascade,
  effort_minutes integer,
  next_action text,
  block_at timestamptz,
  ordinal integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists daily_plan_items_uq on daily_plan_items (plan_id, action_id);

create table if not exists focus_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  action_id uuid references internal_actions(id) on delete set null,
  state text not null default 'running',
  duration_ms integer not null,
  accumulated_ms integer not null default 0,
  started_at timestamptz,
  resume_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists focus_sessions_active_uq on focus_sessions (org_id, user_id) where state in ('running', 'paused');
create index if not exists focus_sessions_user_idx on focus_sessions (org_id, user_id, state);

create table if not exists daily_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  local_date text not null,
  notes text not null default '',
  checks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists daily_reviews_user_day_uq on daily_reviews (org_id, user_id, local_date);
