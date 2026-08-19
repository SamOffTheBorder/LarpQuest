-- Phase 5: harden the new security-definer surfaces, per the existing pattern
-- (20260813000001_harden_helper_functions.sql) — revoke execute from every
-- role by default, re-grant only where a real client needs to call it.

-- Policy-internal helper, same treatment as is_story_member/is_story_owner:
-- never called directly by a client, only from inside RLS policies.
revoke execute on function is_story_role(uuid, text[]) from public, anon, authenticated;

-- join_story_via_invite reads auth.uid(), so it is meaningless to an
-- unauthenticated caller — anon is revoked, but signed-in users must be able
-- to call it directly (that is the entire join flow).
revoke execute on function join_story_via_invite(text) from public, anon;
grant execute on function join_story_via_invite(text) to authenticated;
