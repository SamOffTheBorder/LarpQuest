-- Phase 5: invites — the only path onto a story besides being its creator.
--
-- story_members_insert (Phase 1) only ever admitted the owner. join_story_via_invite
-- is security definer so it can validate a token and insert a membership row in one
-- atomic step, with no window where a client could insert against an already-expired
-- token it read moments earlier.

create table story_invites (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  token text not null unique,
  role text not null check (role in ('gm', 'player', 'spectator')),
  created_by uuid references auth.users on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_uses int,
  use_count int not null default 0,
  created_at timestamptz not null default now()
);

create index story_invites_token_idx on story_invites (token);
create index story_invites_story_idx on story_invites (story_id);

-- Role check used by invite, entity-control, and member-removal policies.
-- security definer so reading story_members inside a policy does not recurse.
create function is_story_role(target_story_id uuid, roles text[])
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
      and story_members.role = any(roles)
  );
$$;

alter table story_invites enable row level security;

create policy story_invites_select on story_invites
  for select using (is_story_role(story_id, array['owner', 'gm']));

create policy story_invites_insert on story_invites
  for insert with check (is_story_role(story_id, array['owner', 'gm']));

create policy story_invites_update on story_invites
  for update
  using (is_story_role(story_id, array['owner', 'gm']))
  with check (is_story_role(story_id, array['owner', 'gm']));

-- No delete policy: revocation is an update (revoked_at), not a deletion —
-- keeps the invite's use_count and history intact.

-- Validates the token and inserts the caller's membership row atomically.
-- security definer: bypasses story_members_insert's owner-only check, since
-- the token itself is the authorization for a non-owner to join.
create function join_story_via_invite(p_token text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite story_invites%rowtype;
  v_uid uuid := (select auth.uid());
  v_existing_role text;
begin
  select * into v_invite from story_invites where token = p_token;

  if v_invite.id is null then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'invite_revoked' using errcode = 'P0001';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;

  if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
    raise exception 'invite_exhausted' using errcode = 'P0001';
  end if;

  select role into v_existing_role
  from story_members
  where story_id = v_invite.story_id and user_id = v_uid;

  if v_existing_role is not null then
    return v_existing_role;
  end if;

  insert into story_members (story_id, user_id, role)
  values (v_invite.story_id, v_uid, v_invite.role);

  update story_invites
  set use_count = use_count + 1
  where id = v_invite.id;

  return v_invite.role;
end;
$$;
