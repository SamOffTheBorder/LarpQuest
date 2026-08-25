-- db advisors flagged story_reports_guard_immutable_fields for a mutable
-- search_path, unlike every other function in this schema.

create or replace function story_reports_guard_immutable_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.reason is distinct from old.reason
    or new.reporter_id is distinct from old.reporter_id
    or new.chapter_id is distinct from old.chapter_id
    or new.submission_id is distinct from old.submission_id
    or new.story_id is distinct from old.story_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'story_reports: only status, resolved_by, and resolved_at may be updated';
  end if;
  return new;
end;
$$;
