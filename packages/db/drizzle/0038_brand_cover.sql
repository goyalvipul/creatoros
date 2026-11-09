-- Each brand (workspace) keeps its own Today photo.
-- The oldest brand inherits the organization photo so the current banner stays put.

alter table brands add column if not exists cover_path text;

update brands b
set cover_path = o.cover_path
from organizations o
where b.org_id = o.id
  and b.cover_path is null
  and o.cover_path is not null
  and b.deleted_at is null
  and b.id = (
    select b2.id
    from brands b2
    where b2.org_id = o.id and b2.deleted_at is null
    order by b2.created_at
    limit 1
  );
