-- Phase 8: full-text search over a story's chapters and entities.
--
-- Postgres tsvector/GIN, no new infrastructure — same precedent as using
-- pgvector directly (Phase 4) rather than an external vector DB. This is a
-- separate, user-facing keyword search surface; it does not reuse or read
-- Phase 4's embedding columns, which serve the memory/context-assembly
-- pipeline instead.
--
-- entities.data is jsonb of arbitrary, schema-defined shape — cast to text
-- for indexing rather than indexed field-by-field, since the engine has no
-- fixed concept of which fields exist for a given universe (build plan
-- Part 0.2: no hardcoded vocabulary).

alter table chapters
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(summary, '')), 'A')
    || setweight(to_tsvector('english', prose), 'B')
  ) stored;

alter table entities
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', name), 'A')
    || setweight(to_tsvector('english', coalesce(data #>> '{}', '')), 'B')
  ) stored;

create index chapters_search_idx on chapters using gin (search_vector);
create index entities_search_idx on entities using gin (search_vector);

-- Ranked search across both tables for one story, membership-checked inside
-- the function (security definer) the same way is_story_member gates every
-- table's RLS, rather than duplicating that check at the call site.
create type story_search_result as (
  kind text,
  id uuid,
  title text,
  snippet text,
  rank real
);

create function search_story(p_story_id uuid, p_query text)
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

revoke execute on function search_story(uuid, text) from public, anon;
grant execute on function search_story(uuid, text) to authenticated;
