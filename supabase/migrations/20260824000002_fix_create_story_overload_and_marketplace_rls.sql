-- Fixes two pre-existing bugs surfaced while testing the Phase 8 polish work,
-- unrelated to the Appearance system added in the prior migration.

-- 1. create_story overload ambiguity.
--
-- 20260817000003_create_story_with_universe.sql used `create or replace
-- function create_story(...)` with a DIFFERENT parameter list (added
-- p_universe_id/p_universe_version). Postgres does not treat that as a
-- replacement — a function is identified by name + argument types, so this
-- created a second overload alongside the original 5-argument version rather
-- than superseding it. The application's one call site (stories.ts's
-- createStory) always calls the RPC by keyword args and only supplies
-- p_universe_id/p_universe_version when pinning a universe, so a call with
-- just the 5 base keys is ambiguous between both overloads and PostgREST
-- refuses to guess. p_universe_id/p_universe_version are optional
-- (default null) on the 7-arg version, so it is a strict superset of the
-- 5-arg one — safe to drop the original outright.
drop function if exists create_story(uuid, text, text, jsonb, jsonb);

-- 2. Marketplace RLS policies calling a revoked-execute helper directly.
--
-- is_story_member/is_story_owner are SECURITY DEFINER, but Postgres still
-- requires the CALLING role to hold EXECUTE to invoke them at all —
-- SECURITY DEFINER only changes what they run AS once invoked, not who may
-- call them. 20260813000001_harden_helper_functions.sql revoked EXECUTE from
-- authenticated/anon specifically to close the direct PostgREST RPC surface
-- (/rest/v1/rpc/is_story_member), on the assumption they'd remain usable
-- "from within policy definitions" — true only for policies evaluated inside
-- another SECURITY DEFINER function's body, not for a plain RLS USING clause,
-- which always evaluates as the querying role. Every pre-Phase-8 use of
-- is_story_member sits inside a plain RLS policy too, but those never
-- surfaced this because every real caller reads through
-- createServiceRoleClient() (which bypasses RLS entirely, running as
-- postgres) rather than the session-bound client. Phase 8's
-- listPublicUniverses is the first function in the codebase to query
-- universes/universe_versions with the session-bound client, so it's the
-- first to actually exercise these policies as `authenticated` and hit the
-- revoked grant.
--
-- Fix: give the two marketplace policies their own narrow SECURITY DEFINER
-- wrapper, granted to authenticated. Any EXECUTE grant on a public-schema
-- SECURITY DEFINER function makes PostgREST expose it at
-- /rest/v1/rpc/<name> regardless of whether the app ever calls it that way
-- (confirmed via `supabase db advisors`) — there is no way to grant EXECUTE
-- for RLS's sake without also opening that route, so this accepts the same
-- trade-off already made for clone_universe/search_story/etc: the function
-- returns only a boolean with no data leak, so direct RPC exposure is
-- tidiness, not a vulnerability. This keeps is_story_member/is_story_owner
-- themselves exactly as locked-down as the hardening migration intended —
-- only this new, narrower helper gains the grant.
create function is_story_member_for_universe(target_universe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from stories
    where stories.universe_id = target_universe_id
      and is_story_member(stories.id)
  );
$$;

revoke execute on function is_story_member_for_universe(uuid) from public, anon;
grant execute on function is_story_member_for_universe(uuid) to authenticated;

drop policy universes_select on universes;

create policy universes_select on universes
  for select using (
    is_public
    or owner_id = (select auth.uid())
    or is_story_member_for_universe(universes.id)
  );

drop policy universe_versions_select on universe_versions;

create policy universe_versions_select on universe_versions
  for select using (
    exists (
      select 1 from universes
      where universes.id = universe_versions.universe_id
        and (
          universes.is_public
          or universes.owner_id = (select auth.uid())
          or is_story_member_for_universe(universes.id)
        )
    )
  );
