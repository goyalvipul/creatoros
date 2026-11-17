alter table h3_drafts add column if not exists video_locked boolean not null default true;
alter table h3_drafts add column if not exists share_video boolean not null default false;
