-- Phase 2: atomic universe/version operations.
--
-- universe_versions has no insert policy for ordinary callers (previous
-- migration) — every version is created through one of these two functions,
-- which enforce ownership themselves. This is what makes versions actually
-- immutable rather than just conventionally so: there is no client-reachable
-- path that writes a universe_versions row except "create version 1 with a
-- new universe" or "append the next version to a universe I own".
--
-- security definer with pinned search_path, execute revoked from anon/
-- authenticated, same as Phase 1's operations: these run from server-side
-- code through the service role, which does its own auth check first.

create function create_universe_with_version(
  p_owner_id uuid,
  p_name text,
  p_entity_schema jsonb,
  p_progression_model text,
  p_progression_config jsonb default '{}'::jsonb
)
returns universe_versions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  new_universe universes;
  new_version universe_versions;
begin
  insert into universes (owner_id, name)
  values (p_owner_id, p_name)
  returning * into new_universe;

  insert into universe_versions (universe_id, version, entity_schema, progression_model, progression_config)
  values (new_universe.id, 1, p_entity_schema, p_progression_model, p_progression_config)
  returning * into new_version;

  return new_version;
end;
$$;

revoke execute on function create_universe_with_version(uuid, text, jsonb, text, jsonb)
  from public, anon, authenticated;

-- Publish the next version of an existing universe. p_owner_id is checked
-- against the universe's owner rather than trusted from the caller, since
-- this runs through the service role and must not let one owner version
-- another owner's universe.
create function publish_universe_version(
  p_universe_id uuid,
  p_owner_id uuid,
  p_entity_schema jsonb,
  p_progression_model text,
  p_progression_config jsonb default '{}'::jsonb
)
returns universe_versions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  next_version int;
  created universe_versions;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_universe_id::text, 1));

  if not exists (
    select 1 from universes
    where id = p_universe_id and owner_id = p_owner_id
  ) then
    raise exception 'universe % not owned by %', p_universe_id, p_owner_id
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(max(version), 0) + 1
  into next_version
  from universe_versions
  where universe_id = p_universe_id;

  insert into universe_versions (universe_id, version, entity_schema, progression_model, progression_config)
  values (p_universe_id, next_version, p_entity_schema, p_progression_model, p_progression_config)
  returning * into created;

  return created;
end;
$$;

revoke execute on function publish_universe_version(uuid, uuid, jsonb, text, jsonb)
  from public, anon, authenticated;
