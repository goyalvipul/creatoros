alter table publish_items add column if not exists cover_path text;
alter table publish_items add column if not exists cover_offset_ms integer;
alter table publish_items add column if not exists cover_source text;
