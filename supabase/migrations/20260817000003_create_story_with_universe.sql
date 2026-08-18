-- Phase 2: let story creation pin a universe version atomically.
--
-- Replaces create_story with an overload-compatible version that accepts an
-- optional universe pin. The pin must be set at creation time in the same
-- transaction as the story row, so a story is never observable in a state
-- where universe_id is set but universe_version is not (or vice versa) —
-- the `stories_universe_pin_pairing` check constraint from the previous
-- migration already guards this at the row level; this function is what lets
-- a caller satisfy it in one atomic step instead of two.

create or replace function create_story(
  p_owner_id uuid,
  p_title text,
  p_content_rating text,
  p_model_config jsonb,
  p_turn_config jsonb default '{}'::jsonb,
  p_universe_id uuid default null,
  p_universe_version int default null
)
returns stories
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  created stories;
begin
  insert into stories (owner_id, title, content_rating, model_config, turn_config, universe_id, universe_version)
  values (p_owner_id, p_title, p_content_rating, p_model_config, p_turn_config, p_universe_id, p_universe_version)
  returning * into created;

  insert into story_members (story_id, user_id, role)
  values (created.id, p_owner_id, 'owner');

  return created;
end;
$$;

revoke execute on function create_story(uuid, text, text, jsonb, jsonb, uuid, int)
  from public, anon, authenticated;

-- Explicit, owner-initiated upgrade of a story's pinned universe version.
-- Never called implicitly — a story keeps its pin until this is invoked, per
-- universe-versioning spec ("Owner explicitly upgrades a story's pinned
-- version"). Entity history is untouched: this only repoints which schema
-- and progression model govern future writes.
create function upgrade_story_universe_version(
  p_story_id uuid,
  p_owner_id uuid,
  p_universe_version int
)
returns stories
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  updated stories;
begin
  if not exists (
    select 1 from story_members
    where story_id = p_story_id and user_id = p_owner_id and role = 'owner'
  ) then
    raise exception 'story % not owned by %', p_story_id, p_owner_id
      using errcode = 'insufficient_privilege';
  end if;

  update stories
  set universe_version = p_universe_version
  where id = p_story_id
    and universe_id is not null
  returning * into updated;

  if not found then
    raise exception 'story % has no universe to upgrade', p_story_id
      using errcode = 'no_data_found';
  end if;

  return updated;
end;
$$;

revoke execute on function upgrade_story_universe_version(uuid, uuid, int)
  from public, anon, authenticated;
