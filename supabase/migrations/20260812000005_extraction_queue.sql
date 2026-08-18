-- Phase 1: extraction queue.
--
-- Extraction runs AFTER a chapter commits and must never block, delay, or
-- reverse publication. A database-backed queue rather than Inngest/Trigger.dev
-- because Phase 1's only async need is retrying one idempotent call; the
-- durable-jobs dependency earns its place in Phase 3, where the research
-- pipeline needs real multi-step orchestration.
--
-- claimed_at supports stale-claim recovery: a crashed worker leaves the row
-- claimable again after a timeout rather than losing the work.

create table extraction_queue (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  story_id uuid not null references stories(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'complete', 'failed')),
  attempt_count int not null default 0,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id)
);

create index extraction_queue_claimable_idx on extraction_queue (status, claimed_at)
  where status in ('queued', 'claimed');

alter table extraction_queue enable row level security;

-- Read-only for members, so the UI can show a pending-extraction indicator.
-- Writes happen through the service role in the worker.
create policy extraction_queue_select on extraction_queue
  for select using (is_story_member(story_id));

create trigger extraction_queue_touch_updated_at
  before update on extraction_queue
  for each row execute function touch_updated_at();

-- Claim the next available job, including any whose claim has gone stale.
-- skip locked so concurrent workers do not block each other.
create function claim_extraction_job(stale_after interval default '5 minutes')
returns extraction_queue
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update extraction_queue
  set status = 'claimed',
      claimed_at = now(),
      attempt_count = attempt_count + 1
  where id = (
    select id
    from extraction_queue
    where status = 'queued'
       or (status = 'claimed' and claimed_at < now() - stale_after)
    order by created_at
    for update skip locked
    limit 1
  )
  returning *;
$$;

revoke execute on function claim_extraction_job(interval) from public, anon, authenticated;
