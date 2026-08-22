-- Ownership transfer.
--
-- No mechanism exists to change who owns a story. That is a real gap on its
-- own — a story's only owner going inactive already leaves it permanently
-- unmanageable, since stories_update/stories_delete gate on is_story_owner()
-- — and it becomes urgent with account deletion: deleting the sole owner's
-- account removes their story_members row (that FK still cascades, correctly
-- — see 20260824000004's comment), which would otherwise leave a story with
-- members but no owner and no way to ever get one again.
--
-- Modeled on join_story_via_invite: a single security definer function so the
-- old-owner-demoted / new-owner-promoted pair commits atomically. A two-step
-- client-side update (demote, then promote) would have a window where RLS
-- evaluates stories_update against zero owners, or briefly needs a caller to
-- already be a non-owner to promote someone else while remaining unable to
-- verify their own outgoing permission — both awkward and racy compared to
-- one function that checks the whole invariant before writing anything.
create function transfer_story_ownership(p_story_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current_role text;
  v_new_owner_role text;
begin
  select role into v_current_role
  from story_members
  where story_id = p_story_id and user_id = v_uid;

  if v_current_role is distinct from 'owner' then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;

  select role into v_new_owner_role
  from story_members
  where story_id = p_story_id and user_id = p_new_owner_id;

  if v_new_owner_role is null then
    raise exception 'target_not_member' using errcode = 'P0001';
  end if;

  if p_new_owner_id = v_uid then
    raise exception 'already_owner' using errcode = 'P0001';
  end if;

  update story_members set role = 'owner'
  where story_id = p_story_id and user_id = p_new_owner_id;

  update story_members set role = 'gm'
  where story_id = p_story_id and user_id = v_uid;

  update stories set owner_id = p_new_owner_id
  where id = p_story_id;
end;
$$;

revoke execute on function transfer_story_ownership(uuid, uuid) from public, anon;
grant execute on function transfer_story_ownership(uuid, uuid) to authenticated;
