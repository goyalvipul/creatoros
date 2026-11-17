alter table long_video_projects add column if not exists motion_plan jsonb;
alter table long_video_projects add column if not exists scene_undo jsonb;
alter table long_video_scenes add column if not exists render_ms integer;
alter table long_video_scenes add column if not exists motion_track_id text;
alter table long_video_scenes add column if not exists motion_review text;
alter table long_video_refs add column if not exists duration_ms integer;
alter table long_video_refs add column if not exists content_sha256 text;
