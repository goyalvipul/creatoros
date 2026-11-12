alter table long_video_scenes add column if not exists song_notes text not null default '';
alter table long_video_scenes add column if not exists image_notes text not null default '';
alter table long_video_scenes add column if not exists image_order jsonb not null default '[]'::jsonb;
