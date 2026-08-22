-- Spend caps with a hard stop (build plan Part 8.3, launch plan A2.1).
--
-- `usage_log` already records what a call cost, but only after it returns.
-- Nothing consulted a budget beforehand, so a story in a retry loop could
-- spend without limit. This adds the limits and the aggregate the gateway
-- checks before every model call.
--
-- On exactness: cost is knowable only after a call completes, so a
-- check-then-spend sequence can overshoot when calls run concurrently — two
-- callers can both pass a check that only one of them should have. The
-- overshoot is bounded by (concurrent calls x cost of one call), which is
-- cents, and the alternative (reserving an estimated budget before each call,
-- then reconciling) buys exactness this deployment does not need. The Terms
-- describe caps as a convenience rather than a guarantee for this reason.
-- The real backstop is the spend limit set at the provider.

-- Per-story cap. Null means "no story-level limit" — the account-wide default
-- still applies, so null is not unlimited.
alter table stories
  add column spend_cap_usd numeric(10, 2)
    check (spend_cap_usd is null or spend_cap_usd >= 0);

comment on column stories.spend_cap_usd is
  'Hard cap on total usage_log cost for this story. Null falls back to the deployment default.';

-- Per-user cap, alongside the existing appearance preferences. Same null
-- semantics.
alter table user_preferences
  add column spend_cap_usd numeric(10, 2)
    check (spend_cap_usd is null or spend_cap_usd >= 0);

comment on column user_preferences.spend_cap_usd is
  'Hard cap on total usage_log cost attributed to this user across all stories.';

-- usage_log is indexed on (story_id, created_at) already; the per-user sum
-- needs its own index or it degrades to a sequential scan on every model call.
create index usage_log_user_idx on usage_log (user_id, created_at);

-- Spend to date for a story and a user, in one round trip against one
-- snapshot. Returning both from a single function keeps the gateway's
-- pre-call check to a single statement.
--
-- security definer because the gateway calls this through the service role in
-- worker and Inngest contexts where there is no auth.uid() to satisfy the
-- usage_log select policy. It exposes only two aggregates, never rows.
-- search_path is pinned per CVE-2018-1058.
--
-- Execute is granted to service_role only, deliberately. The arguments are
-- arbitrary ids, so a definer function reachable by `authenticated` would let
-- any signed-in user read any other user's total spend by guessing a uuid.
-- The gateway is the only caller, and it always runs as the service role.
create function spend_to_date(target_story_id uuid, target_user_id uuid)
returns table (story_spend_usd numeric, user_spend_usd numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(sum(cost_usd) filter (
      where target_story_id is not null and story_id = target_story_id
    ), 0) as story_spend_usd,
    coalesce(sum(cost_usd) filter (
      where target_user_id is not null and user_id = target_user_id
    ), 0) as user_spend_usd
  from usage_log
  where
    (target_story_id is not null and story_id = target_story_id)
    or (target_user_id is not null and user_id = target_user_id);
$$;

revoke execute on function spend_to_date(uuid, uuid) from public, anon, authenticated;

grant execute on function spend_to_date(uuid, uuid) to service_role;
