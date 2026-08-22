-- Fix: joining via invite as a non-owner/gm (player or spectator) always
-- failed client-side after a successful join.
--
-- join_story_via_invite only ever returned the granted role. invites.ts
-- resolved the story id with a second, client-session query against
-- story_invites — but story_invites_select only allows owner/gm to read
-- (20260820000001), so that lookup was blocked by RLS for anyone who joined
-- with a lesser role. The membership row was inserted successfully; only the
-- follow-up read failed, surfacing as a generic "couldn't join" error.
--
-- Fix at the source: have the security-definer function return the story id
-- it already has in hand, so no follow-up client query (and no RLS gate) is
-- needed at all.
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

  insert into story_members (story_id, user_id, role)
  values (v_invite.story_id, v_uid, v_invite.role);

  update story_invites
  set use_count = use_count + 1
  where id = v_invite.id;

  return query select v_invite.role, v_invite.story_id;
end;
$$;

revoke execute on function join_story_via_invite(text) from public, anon;
grant execute on function join_story_via_invite(text) to authenticated;
