-- Usernames, leaving a story, and invite attribution.
--
-- Three related gaps, grouped because the members page needs all three at once:
--
--   1. Members are rendered as raw uuids — there is no display name anywhere in
--      the schema. profiles gives every account one.
--   2. removeMember is owner/gm-only, so a player who wants out has to ask
--      someone else to eject them. leave_story lets them go on their own.
--   3. story_members records that someone joined, but not which invite let them
--      in, so "who joined from what link" is unanswerable.

-- Usernames are public within the app: you see the display name of everyone in
-- your stories, which is the entire point of having one. Uniqueness is
-- case-insensitive so `Alice` and `alice` cannot both be taken.
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_username_lower_idx on profiles (lower(username));

-- 3..32 chars, alphanumeric plus underscore/hyphen. Enforced here as well as
-- in Zod: the DB is the boundary that actually holds when a call site forgets.
alter table profiles add constraint profiles_username_format
  check (username ~ '^[A-Za-z0-9_-]{3,32}$');

alter table profiles enable row level security;

-- Readable by any signed-in user: a display name is meaningless if the people
-- sharing your story cannot resolve it. No anon read — signed-out visitors on
-- a share link see chapter prose, not the roster.
create policy profiles_select on profiles
  for select to authenticated using (true);

create policy profiles_insert on profiles
  for insert to authenticated with check (id = (select auth.uid()));

create policy profiles_update on profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No delete policy: the row goes when the account does, via the cascade above.

-- Which invite a member came in through. `on delete set null` (not cascade):
-- losing the invite must never remove someone from the story it admitted them
-- to — the membership is the durable fact, the attribution is a nicety.
alter table story_members
  add column joined_via_invite uuid references story_invites(id) on delete set null;

-- Record the invite on the way in. Same body as 20260824000007 plus the one
-- new column; replaced wholesale because plpgsql has no partial redefinition.
drop function join_story_via_invite(text);

create function join_story_via_invite(p_token text)
returns table (role text, story_id uuid)
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

  select story_members.role into v_existing_role
  from story_members
  where story_members.story_id = v_invite.story_id and story_members.user_id = v_uid;

  if v_existing_role is not null then
    return query select v_existing_role, v_invite.story_id;
    return;
  end if;

  insert into story_members (story_id, user_id, role, joined_via_invite)
  values (v_invite.story_id, v_uid, v_invite.role, v_invite.id);

  update story_invites
  set use_count = use_count + 1
  where id = v_invite.id;

  return query select v_invite.role, v_invite.story_id;
end;
$$;

revoke execute on function join_story_via_invite(text) from public, anon;
grant execute on function join_story_via_invite(text) to authenticated;

-- Leaving under your own power.
--
-- The owner is refused rather than allowed to strand the story: stories_update
-- and stories_delete both gate on is_story_owner(), so a story with members and
-- no owner is permanently unmanageable — the same invariant
-- transfer_story_ownership exists to protect. An owner who wants out transfers
-- first, then leaves.
--
-- Entities the leaver controlled are released, matching removeMember: a
-- character left pointing at a departed member is worse than an unclaimed one,
-- which a GM can reassign or narrate out.
create function leave_story(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
begin
  select role into v_role
  from story_members
  where story_id = p_story_id and user_id = v_uid;

  if v_role is null then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  if v_role = 'owner' then
    raise exception 'owner_cannot_leave' using errcode = 'P0001';
  end if;

  update entities set controlled_by = null
  where story_id = p_story_id and controlled_by = v_uid;

  delete from story_members
  where story_id = p_story_id and user_id = v_uid;
end;
$$;

revoke execute on function leave_story(uuid) from public, anon;
grant execute on function leave_story(uuid) to authenticated;
