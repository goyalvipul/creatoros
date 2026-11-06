-- Audience breakdowns from YouTube, Instagram and Facebook. The numeric value stays null when the report is a labelled list.
alter table account_metric_snapshots add column if not exists detail jsonb;
