-- Phase 1: stories, membership, and the RLS pattern every later table inherits.
--
-- Access to every story-scoped row is gated through story_members, even though
-- the owner is the only possible member in Phase 1. Retrofitting policies
-- across a dozen tables while multiplayer semantics are also in flux is where
-- authorization bugs come from; writing it once against a one-row table costs
-- almost nothing.

create extension if not exists pgcrypto;

create table stories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  content_rating text not null,
  model_config jsonb not null default '{}'::jsonb,
  turn_config jsonb not null default '{}'::jsonb,
  world_ledger jsonb not null default '{}'::jsonb,
  current_turn int not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table story_members (
  story_id uuid not null references stories(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'gm', 'player', 'spectator')),
  joined_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index story_members_user_idx on story_members (user_id);
create index stories_owner_idx on stories (owner_id);

-- Membership check used by every story-scoped policy in the schema.
--
-- security definer so that reading story_members inside a story_members policy
-- does not recurse. search_path is pinned per CVE-2018-1058.
create function is_story_member(target_story_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from story_members
    where story_members.story_id = target_story_id
      and story_members.user_id = (select auth.uid())
  );
$$;

create function is_story_owner(target_story_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from story_members
    where story_members.story_id = target_story_id
      and story_members.user_id = (select auth.uid())
      and story_members.role = 'owner'
  );
$$;

alter table stories enable row level security;
alter table story_members enable row level security;

create policy stories_select on stories
  for select using (is_story_member(id));

-- The creating user must be the owner. Their story_members row is inserted in
-- the same transaction by the application.
create policy stories_insert on stories
  for insert with check (owner_id = (select auth.uid()));

create policy stories_update on stories
  for update using (is_story_owner(id)) with check (is_story_owner(id));

create policy stories_delete on stories
  for delete using (is_story_owner(id));

create policy story_members_select on story_members
  for select using (is_story_member(story_id));

-- Covers the bootstrap case: the owner row is inserted by the user who owns
-- the story, before any membership row exists to check against.
create policy story_members_insert on story_members
  for insert with check (
    is_story_owner(story_id)
    or exists (
      select 1 from stories
      where stories.id = story_members.story_id
        and stories.owner_id = (select auth.uid())
    )
  );

create policy story_members_update on story_members
  for update using (is_story_owner(story_id)) with check (is_story_owner(story_id));

create policy story_members_delete on story_members
  for delete using (is_story_owner(story_id));

create function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger stories_touch_updated_at
  before update on stories
  for each row execute function touch_updated_at();
