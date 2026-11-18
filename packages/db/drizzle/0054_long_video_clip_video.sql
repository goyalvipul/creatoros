alter table long_video_scenes add column if not exists video_name text;
alter table long_video_scenes add column if not exists video_start_ms integer;
alter table long_video_scenes add column if not exists video_end_ms integer;
