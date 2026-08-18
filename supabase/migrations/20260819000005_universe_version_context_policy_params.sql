-- Phase 4: accept context_policy and compressed canon bible on universe
-- version creation/publish, so both are written in the same transaction as
-- entity_schema rather than needing a follow-up update.
--
-- Defaults match schemas.ts's DEFAULT_CONTEXT_POLICY and the migration
-- default from 20260819000002_context_policy.sql exactly.
--
-- `create or replace` cannot change a function's parameter list — it would
-- silently create a second overload alongside the original 5-arg signature
-- rather than replacing it. Drop the old signatures explicitly first.

drop function if exists create_universe_with_version(uuid, text, jsonb, text, jsonb);
drop function if exists publish_universe_version(uuid, uuid, jsonb, text, jsonb);

create function create_universe_with_version(
  p_owner_id uuid,
  p_name text,
  p_entity_schema jsonb,
  p_progression_model text,
  p_progression_config jsonb default '{}'::jsonb,
  p_context_policy jsonb default '{
    "recent_chapters": 3,
    "retrieved_chapters": 5,
    "retrieval_bias": "precedent",
    "canon_compression": "full",
    "token_budget": 24000
  }'::jsonb,
  p_canon_bible_summary jsonb default null,
  p_canon_bible_rules_only jsonb default null
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

  insert into universe_versions (
    universe_id, version, entity_schema, progression_model, progression_config,
    context_policy, canon_bible_summary, canon_bible_rules_only
  )
  values (
    new_universe.id, 1, p_entity_schema, p_progression_model, p_progression_config,
    p_context_policy, p_canon_bible_summary, p_canon_bible_rules_only
  )
  returning * into new_version;

  return new_version;
end;
$$;

revoke execute on function create_universe_with_version(uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;

create function publish_universe_version(
  p_universe_id uuid,
  p_owner_id uuid,
  p_entity_schema jsonb,
  p_progression_model text,
  p_progression_config jsonb default '{}'::jsonb,
  p_context_policy jsonb default '{
    "recent_chapters": 3,
    "retrieved_chapters": 5,
    "retrieval_bias": "precedent",
    "canon_compression": "full",
    "token_budget": 24000
  }'::jsonb,
  p_canon_bible_summary jsonb default null,
  p_canon_bible_rules_only jsonb default null
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

  insert into universe_versions (
    universe_id, version, entity_schema, progression_model, progression_config,
    context_policy, canon_bible_summary, canon_bible_rules_only
  )
  values (
    p_universe_id, next_version, p_entity_schema, p_progression_model, p_progression_config,
    p_context_policy, p_canon_bible_summary, p_canon_bible_rules_only
  )
  returning * into created;

  return created;
end;
$$;

revoke execute on function publish_universe_version(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
