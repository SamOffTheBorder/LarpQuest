-- Phase 2: universes and their immutable versions.
--
-- A universe is a named, owned container for an Entity Schema and a
-- Progression Model, versioned independently of any story (build plan
-- Part 2.4, Part 11.1). Stories that opt in pin a specific
-- (universe_id, universe_version) pair and keep it until an explicit owner
-- upgrade — a universe publishing a new version must never retroactively
-- change a running story's schema or progression semantics.
--
-- universe_versions is append-only, like entity_history: no update or delete
-- policy is defined, so no non-service-role caller can mutate a published
-- version. "Editing" a universe is implemented as inserting a new version row
-- (see publish_universe_version in the next migration), never as an update.

create table universes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);

create index universes_owner_idx on universes (owner_id);

create table universe_versions (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid not null references universes(id) on delete cascade,
  version int not null check (version > 0),
  entity_schema jsonb not null,
  progression_model text not null,
  progression_config jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (universe_id, version)
);

create index universe_versions_universe_idx on universe_versions (universe_id);

-- Stories may pin a universe version. Nullable and unbackfilled: a story
-- created before this migration, or created without a universe, keeps
-- Phase 1's fully schemaless behavior forever — this is not a migration path
-- every story eventually takes.
alter table stories
  add column universe_id uuid references universes(id),
  add column universe_version int;

alter table stories
  add constraint stories_universe_version_fk
  foreign key (universe_id, universe_version)
  references universe_versions (universe_id, version);

alter table stories
  add constraint stories_universe_pin_pairing
  check (
    (universe_id is null and universe_version is null)
    or (universe_id is not null and universe_version is not null)
  );

alter table universes enable row level security;
alter table universe_versions enable row level security;

create policy universes_select on universes
  for select using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from stories
      where stories.universe_id = universes.id
        and is_story_member(stories.id)
    )
  );

create policy universes_insert on universes
  for insert with check (owner_id = (select auth.uid()));

create policy universes_update on universes
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy universes_delete on universes
  for delete using (owner_id = (select auth.uid()));

create policy universe_versions_select on universe_versions
  for select using (
    exists (
      select 1 from universes
      where universes.id = universe_versions.universe_id
        and (
          universes.owner_id = (select auth.uid())
          or exists (
            select 1 from stories
            where stories.universe_id = universes.id
              and is_story_member(stories.id)
          )
        )
    )
  );

-- No insert/update/delete policy for universe_versions: rows are written only
-- through the security-definer RPCs in the next migration, which verify
-- ownership themselves. Absent policies deny these operations for every
-- non-service-role caller, keeping versions immutable end to end.
