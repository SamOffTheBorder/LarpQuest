-- Rate limiting (launch plan B3.1).
--
-- Nothing in the app limits how often a caller can hit an expensive or
-- abusable path: sign-in requests (email bombing), story/universe creation,
-- research pipeline runs (5-15 minutes of expensive model calls per run),
-- turn generation, and invite creation.
--
-- Backed by Postgres rather than an external store (Upstash/Redis): the
-- deployment already depends on this database for every other piece of
-- shared state — extraction_queue, spend_to_date — and adding a second
-- coordination store is a cost this deployment's scale does not justify. A
-- fixed-window counter checked and incremented in one atomic statement is
-- the same tradeoff spend_to_date already makes for money: not exact under
-- extreme concurrency, cheap, and correct in the case that actually matters
-- (a single caller looping, not a distributed attack timed to the millisecond).

create table rate_limit_counters (
  -- Composite key: one row per (action, key, window). `key` is caller
  -- identity — a user id for authenticated actions, an IP address for
  -- sign-in, which has no session yet to key on.
  action text not null,
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (action, key, window_start)
);

-- Old windows accumulate forever without this. A caller checks at most one
-- current window per action per call, so a plain btree range scan on a
-- monthly prune is enough — this table does not need to stay small in real
-- time, only bounded.
create index rate_limit_counters_window_idx on rate_limit_counters (window_start);

alter table rate_limit_counters enable row level security;
-- No policies: every access goes through the service-role client via
-- check_rate_limit below, the same way extraction_queue is never queried
-- directly by client code. An RLS table with zero policies denies all access
-- to non-service-role callers by default, which is the point.

-- Atomically increments the counter for (action, key) in its current window
-- and reports whether the caller is still within the limit. One statement
-- rather than read-then-write specifically to close the race a naive
-- check-then-increment would have under concurrent requests from the same
-- caller — `on conflict do update` makes the increment and the read of the
-- resulting count a single operation.
--
-- security definer + search_path pin per the usual CVE-2018-1058 discipline.
-- Granted to service_role only: like spend_to_date, callers pass an arbitrary
-- `key`, and this is an internal accounting primitive, not something a client
-- should invoke directly with a key of its choosing.
create function check_rate_limit(
  p_action text,
  p_key text,
  p_limit int,
  p_window_seconds int
)
returns table (allowed boolean, current_count int, retry_after_seconds int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  -- Fixed windows, not sliding: floor the current time to the window size.
  -- A caller can burst up to 2x the limit across a window boundary, which is
  -- an acceptable trade for a single indexed upsert instead of a scan over a
  -- sliding range on every check — see the module comment.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limit_counters (action, key, window_start, count)
  values (p_action, p_key, v_window_start, 1)
  on conflict (action, key, window_start)
    do update set count = rate_limit_counters.count + 1
  returning rate_limit_counters.count into v_count;

  return query select
    v_count <= p_limit,
    v_count,
    case
      when v_count <= p_limit then 0
      else ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - now())))::int
    end;
end;
$$;

revoke execute on function check_rate_limit(text, text, int, int) from public, anon, authenticated;
grant execute on function check_rate_limit(text, text, int, int) to service_role;
