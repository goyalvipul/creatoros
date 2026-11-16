alter table publish_drafts add column if not exists sent_posts jsonb not null default '[]'::jsonb;
