alter table long_video_projects add column if not exists megapixels double precision not null default 1;
alter table long_video_projects add column if not exists task_mode text not null default 'ref';
alter table long_video_projects add column if not exists continuity text not null default 'shot';
alter table long_video_projects add column if not exists ref_size text not null default 'max';
