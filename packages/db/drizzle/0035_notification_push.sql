alter table notifications add column if not exists category text not null default 'system';
alter table notifications add column if not exists priority text not null default 'normal';
alter table notifications add column if not exists action jsonb;
alter table notifications add column if not exists archived_at timestamptz;
alter table notification_preferences add column if not exists channels jsonb not null default '{}'::jsonb;

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  endpoint_hash text not null,
  secret_ref text not null,
  user_agent text,
  revoked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists push_subscriptions_endpoint_uq on push_subscriptions (endpoint_hash);
create index if not exists push_subscriptions_user_idx on push_subscriptions (org_id, user_id);

create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  notification_id uuid not null references notifications(id) on delete cascade,
  subscription_id uuid references push_subscriptions(id) on delete cascade,
  channel text not null default 'push',
  state text not null default 'PENDING',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists notification_deliveries_uq on notification_deliveries (notification_id, subscription_id);
create index if not exists notification_deliveries_due_idx on notification_deliveries (state, next_attempt_at);
