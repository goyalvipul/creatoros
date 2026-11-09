alter table long_video_scenes add column if not exists continuity text not null default 'shot';
alter table long_video_scenes add column if not exists shown_job_id uuid;
alter table long_video_scenes add column if not exists prior_job_id uuid;
alter table long_video_scenes add column if not exists prior_take_path text;
