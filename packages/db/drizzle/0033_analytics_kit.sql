-- Metric snapshots, sync runs, recommendations and the public media kit.
-- Historical publication rows are left in place.

create table if not exists account_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  platform text not null,
  metric text not null,
  value double precision,
  state text not null,
  collected_at timestamptz not null default now(),
  reporting_on date,
  endpoint text,
  definition text,
  provenance text not null default 'VERIFIED_PLATFORM'
);
create index if not exists account_metric_snapshots_idx
  on account_metric_snapshots (org_id, social_account_id, metric, collected_at desc);

create table if not exists analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  social_account_id uuid references social_accounts(id) on delete set null,
  platform text,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  stats jsonb not null default '{}'::jsonb
);
create index if not exists analytics_sync_runs_idx on analytics_sync_runs (org_id, started_at desc);

create table if not exists media_kits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organizations(id) on delete cascade,
  slug text not null unique,
  draft jsonb not null default '{}'::jsonb,
  published jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists media_kit_inquiries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kit_id uuid not null references media_kits(id) on delete cascade,
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists analytics_recommendations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  algorithm text not null,
  body jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists content_experiments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  recommendation_id uuid references analytics_recommendations(id) on delete set null,
  action_id uuid references internal_actions(id) on delete set null,
  metric text not null,
  baseline double precision,
  review_on date,
  status text not null default 'OPEN',
  result jsonb,
  created_at timestamptz not null default now()
);
