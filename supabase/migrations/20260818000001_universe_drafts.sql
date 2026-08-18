-- Phase 3: research drafts and their per-stage jobs.
--
-- A draft exists before any story or universe does — there is no story to
-- gate access through, so RLS here is owner_id = auth.uid() rather than the
-- is_story_member() pattern every other table in this schema uses. This is a
-- deliberate, documented exception (design.md decision 1 of
-- phase-3-research-pipeline): the object being protected genuinely has no
-- story yet. Once a draft is published, the resulting universe row is owned
-- exactly like any Phase 2 universe (universes.owner_id, same RLS shape).
--
-- research_jobs is one row per Part 2.2 stage (eight per draft). Unlike
-- Phase 1's extraction_queue, stage execution order and resumption are
-- tracked by Inngest's own step checkpointing, not by claim_extraction_job-
-- style row claiming — these rows exist for observability and realtime UI
-- progress, not as the source of retry truth.

create table universe_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  status text not null default 'researching'
    check (status in ('researching', 'ready_for_review', 'published')),
  input jsonb not null,
  draft jsonb not null default '{}'::jsonb,
  universe_id uuid references universes(id),
  published_version int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index universe_drafts_owner_idx on universe_drafts (owner_id);

create table research_jobs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references universe_drafts(id) on delete cascade,
  stage text not null check (stage in (
    'scoping', 'rules_mechanics', 'progression', 'entities',
    'timeline', 'schema_derivation', 'rule_pack', 'gaps'
  )),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed', 'skipped')),
  attempt_count int not null default 0,
  output jsonb,
  previous_output jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (draft_id, stage)
);

create index research_jobs_draft_idx on research_jobs (draft_id);

alter table universe_drafts enable row level security;
alter table research_jobs enable row level security;

create policy universe_drafts_select on universe_drafts
  for select using (owner_id = (select auth.uid()));

create policy universe_drafts_insert on universe_drafts
  for insert with check (owner_id = (select auth.uid()));

create policy universe_drafts_update on universe_drafts
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- No delete policy: a draft is never removed, even after publishing (see
-- publish path, universe-review spec "Published draft records its outcome").

create policy research_jobs_select on research_jobs
  for select using (
    exists (
      select 1 from universe_drafts
      where universe_drafts.id = research_jobs.draft_id
        and universe_drafts.owner_id = (select auth.uid())
    )
  );

-- No insert/update/delete policy for research_jobs: rows are written only by
-- the service role from the Inngest function and server actions that already
-- verify draft ownership themselves, mirroring extraction_queue's
-- write-only-through-service-role shape.

create trigger universe_drafts_touch_updated_at
  before update on universe_drafts
  for each row execute function touch_updated_at();

create trigger research_jobs_touch_updated_at
  before update on research_jobs
  for each row execute function touch_updated_at();

alter publication supabase_realtime add table research_jobs;
