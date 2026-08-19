-- Phase 8: universe marketplace — is_public, forked_from, and the public-read
-- RLS policy neither one had before this migration.
--
-- The build plan's Part 8.2 sketch shows is_public/forked_from on universes
-- from the start, but Phase 2 (20260817000001_universes.sql) never created
-- them — universes there are identity-only (owner_id, name), with all
-- versioned content on universe_versions. This migration adds both columns
-- where the rest of Phase 2/3/4/6 already put every other universe-level
-- concept: on universes for public/fork bookkeeping (identity-level, not
-- versioned), continuing to read content from universe_versions.
--
-- forked_from is nullable and points at the source universe, not a specific
-- source version — a fork copies one version's content as its own starting
-- version 1, and is fully independent from that point on (Phase 2's
-- versioning precedent: editing the original never retroactively touches a
-- story that pinned a version, and here never touches a fork either).

alter table universes
  add column is_public boolean not null default false,
  add column forked_from uuid references universes(id) on delete set null;

create index universes_is_public_idx on universes (is_public) where is_public;

-- universes_select (20260817000001) only ever allowed the owner or a member
-- of a story using the universe. A public universe must be browsable by any
-- authenticated user who is neither. Dropped and recreated rather than
-- ALTERed, since Postgres has no ALTER POLICY ... ADD CONDITION.
drop policy universes_select on universes;

create policy universes_select on universes
  for select using (
    is_public
    or owner_id = (select auth.uid())
    or exists (
      select 1 from stories
      where stories.universe_id = universes.id
        and is_story_member(stories.id)
    )
  );

-- Same widening for universe_versions: a public universe's content must be
-- readable (to preview before cloning), not just its identity row.
drop policy universe_versions_select on universe_versions;

create policy universe_versions_select on universe_versions
  for select using (
    exists (
      select 1 from universes
      where universes.id = universe_versions.universe_id
        and (
          universes.is_public
          or universes.owner_id = (select auth.uid())
          or exists (
            select 1 from stories
            where stories.universe_id = universes.id
              and is_story_member(stories.id)
          )
        )
    )
  );

-- Clone a public (or owned) universe's latest version into a brand-new,
-- independently-owned universe at version 1. Mirrors
-- create_universe_with_version's shape exactly (it does the actual insert),
-- so a fork and a hand-created universe are indistinguishable in storage
-- apart from forked_from being set.
create function clone_universe(p_universe_id uuid, p_owner_id uuid)
returns universe_versions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  source_universe universes;
  source_version universe_versions;
  new_version universe_versions;
begin
  select * into source_universe from universes where id = p_universe_id;

  if source_universe is null then
    raise exception 'universe % does not exist', p_universe_id;
  end if;

  if not (source_universe.is_public or source_universe.owner_id = p_owner_id) then
    raise exception 'universe % is not public and is not owned by %', p_universe_id, p_owner_id;
  end if;

  select * into source_version
  from universe_versions
  where universe_id = p_universe_id
  order by version desc
  limit 1;

  if source_version is null then
    raise exception 'universe % has no published version to clone', p_universe_id;
  end if;

  select * into new_version
  from create_universe_with_version(
    p_owner_id,
    source_universe.name,
    source_version.entity_schema,
    source_version.progression_model,
    source_version.progression_config,
    source_version.context_policy,
    source_version.canon_bible_summary,
    source_version.canon_bible_rules_only,
    source_version.validation_rules
  );

  update universes
  set forked_from = p_universe_id
  where id = new_version.universe_id;

  return new_version;
end;
$$;

revoke execute on function clone_universe(uuid, uuid) from public, anon;
grant execute on function clone_universe(uuid, uuid) to authenticated;
