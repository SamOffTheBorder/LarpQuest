-- Phase 4: chapter memory — embeddings, the memory queue, and arc summaries.
--
-- `embedding` and the `vector` extension were deliberately deferred from the
-- Phase 1 chapters migration to here (see that migration's header comment).
--
-- memory_status is independent of extraction_status: summary/embedding
-- generation and state-diff extraction are separate failure domains that can
-- succeed or fail independently, so they get separate columns rather than one
-- combined status that would conflate "state didn't update" with "this
-- chapter won't show up in future retrieval."
--
-- memory_queue mirrors extraction_queue's shape and RLS exactly (see
-- 20260812000005_extraction_queue.sql) rather than overloading that table
-- with a job-type discriminant — same precedent as research_jobs being its
-- own table instead of folded into extraction_queue.

create extension if not exists vector;

alter table chapters
  add column embedding vector(1536),
  add column memory_status text not null default 'pending'
    check (memory_status in ('pending', 'complete', 'failed'));

create index chapters_embedding_idx on chapters
  using ivfflat (embedding vector_cosine_ops);

create index chapters_memory_status_idx on chapters (memory_status)
  where memory_status <> 'complete';

create table memory_queue (
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

create index memory_queue_claimable_idx on memory_queue (status, claimed_at)
  where status in ('queued', 'claimed');

alter table memory_queue enable row level security;

-- Read-only for members, so the UI can show a pending-memory indicator.
-- Writes happen through the service role in the worker.
create policy memory_queue_select on memory_queue
  for select using (is_story_member(story_id));

create trigger memory_queue_touch_updated_at
  before update on memory_queue
  for each row execute function touch_updated_at();

-- Claim the next available job, including any whose claim has gone stale.
-- skip locked so concurrent workers do not block each other. Identical
-- structure to claim_extraction_job.
create function claim_memory_job(stale_after interval default '5 minutes')
returns memory_queue
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update memory_queue
  set status = 'claimed',
      claimed_at = now(),
      attempt_count = attempt_count + 1
  where id = (
    select id
    from memory_queue
    where status = 'queued'
       or (status = 'claimed' and claimed_at < now() - stale_after)
    order by created_at
    for update skip locked
    limit 1
  )
  returning *;
$$;

revoke execute on function claim_memory_job(interval) from public, anon, authenticated;

-- Arc summaries (build plan Part 8.2). One row per closed 10-15 chapter arc,
-- generated once a story crosses the arc-compaction threshold (Part 6.4), so
-- distant history retrieves at arc granularity instead of chapter granularity
-- and context size does not grow linearly with story length.
create table arc_summaries (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  from_chapter int not null,
  to_chapter int not null,
  summary text not null,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  check (to_chapter >= from_chapter)
);

create index arc_summaries_story_idx on arc_summaries (story_id, from_chapter);

create index arc_summaries_embedding_idx on arc_summaries
  using ivfflat (embedding vector_cosine_ops);

alter table arc_summaries enable row level security;

create policy arc_summaries_select on arc_summaries
  for select using (is_story_member(story_id));

-- No insert/update/delete policy: written only by the service-role memory
-- worker, matching every other generated-artifact table in this schema.
