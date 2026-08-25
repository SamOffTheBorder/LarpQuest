-- Report resolution and chapter hiding (moderation-report-queue).
--
-- story_reports has never had an update policy — reports were append-only.
-- This adds one narrow mutation: marking a report resolved, without letting
-- its reason, reporter, or target be altered after the fact.

alter table story_reports
  add column status text not null default 'open' check (status in ('open', 'resolved')),
  add column resolved_by uuid references auth.users on delete set null,
  add column resolved_at timestamptz;

-- Enforces that an UPDATE can only ever touch status/resolved_by/resolved_at.
-- RLS alone can gate *who* may update a row, not *which columns* they touch;
-- this is the standard way to add that column-level restriction.
create function story_reports_guard_immutable_fields()
returns trigger
language plpgsql
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

create trigger story_reports_guard_immutable_fields
  before update on story_reports
  for each row execute function story_reports_guard_immutable_fields();

create policy story_reports_update on story_reports
  for update using (is_story_role(story_id, array['owner', 'gm']))
  with check (is_story_role(story_id, array['owner', 'gm']));

-- Chapter hiding: a display-only concern. The row, its prose, and everything
-- derived from it (entity_history, extracted_diffs, validation_report) are
-- untouched — only whether non-manager members, exports, and share links are
-- shown it changes. No RLS change: the existing chapters_select policy
-- already gates on story membership, and "hidden from non-managers" is an
-- application-level filter applied in listChapters/export/share-links/
-- search_story, the same way this codebase already gates admin-only actions
-- through requireRole rather than through RLS role checks on every table.

alter table chapters
  add column hidden_at timestamptz,
  add column hidden_by uuid references auth.users on delete set null;

-- search_story: exclude hidden chapters from full-text search results for
-- everyone (search has no notion of "the current viewer is a manager", the
-- same reason export and share-links filter unconditionally per design.md).
create or replace function search_story(p_story_id uuid, p_query text)
returns setof story_search_result
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q tsquery := websearch_to_tsquery('english', p_query);
begin
  if not is_story_member(p_story_id) then
    raise exception 'not a member of story %', p_story_id;
  end if;

  return query
    select
      'chapter'::text as kind,
      chapters.id,
      ('Chapter ' || chapters.turn_number)::text as title,
      ts_headline('english', coalesce(chapters.summary, chapters.prose), q,
        'MaxFragments=1, MaxWords=35, MinWords=15') as snippet,
      ts_rank(chapters.search_vector, q) as rank
    from chapters
    where chapters.story_id = p_story_id
      and chapters.hidden_at is null
      and chapters.search_vector @@ q
    union all
    select
      'entity'::text as kind,
      entities.id,
      entities.name as title,
      ts_headline('english', coalesce(entities.data #>> '{}', ''), q,
        'MaxFragments=1, MaxWords=35, MinWords=15') as snippet,
      ts_rank(entities.search_vector, q) as rank
    from entities
    where entities.story_id = p_story_id
      and entities.search_vector @@ q
    order by rank desc;
end;
$$;
