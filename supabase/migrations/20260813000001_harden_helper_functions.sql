-- Hardening pass on the Phase 1 helper functions, per findings from
-- `supabase db advisors` run against the live project after the initial push.
--
-- 1. touch_updated_at had no search_path pin, unlike is_story_member and
--    is_story_owner. Same CVE-2018-1058 class of risk: an unqualified
--    reference inside the function body could be redirected by a caller-
--    controlled search_path. It doesn't reference any table by name today,
--    but pinning it now costs nothing and matches the other two.
--
-- 2. is_story_member and is_story_owner were reachable directly via
--    PostgREST RPC (/rest/v1/rpc/...) by anon and authenticated roles. They
--    only return a boolean so this was not a data leak, but they are policy
--    helpers, not public API — revoke direct execution and leave them
--    callable only from within policy definitions and other SECURITY DEFINER
--    contexts, which do not go through the PostgREST grant.

create or replace function touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function is_story_member(uuid) from public, anon, authenticated;
revoke execute on function is_story_owner(uuid) from public, anon, authenticated;
