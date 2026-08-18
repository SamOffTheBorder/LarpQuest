-- Phase 1: turns and submissions.
--
-- Submissions are a separate table from generation state by design (build plan
-- Part 11.3). No generation outcome — failure, timeout, retry exhaustion — may
-- delete or alter a submission. A failed turn is retryable and reuses them.

create table turns (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  turn_number int not null,
  mode text not null default 'freeform',
  scene_setup text,
  status text not null default 'open'
    check (status in ('open', 'locked', 'generating', 'published', 'failed')),
  -- Retained across failures so a timeout does not discard generated tokens.
  partial_prose text,
  failure_reason text,
  attempt_count int not null default 0,
  deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (story_id, turn_number)
);

create index turns_story_status_idx on turns (story_id, status);

-- At most one live (non-published) turn per story. Enforced in the database
-- rather than only in application code, since it is the invariant the whole
-- turn loop rests on.
create unique index turns_one_live_per_story
  on turns (story_id)
  where status <> 'published';

create table submissions (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references turns(id) on delete cascade,
  story_id uuid not null references stories(id) on delete cascade,
  entity_id uuid references entities(id) on delete set null,
  user_id uuid not null references auth.users on delete cascade,
  content text not null check (length(trim(content)) > 0),
  proposals jsonb,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index submissions_turn_idx on submissions (turn_id);

alter table turns enable row level security;
alter table submissions enable row level security;

create policy turns_select on turns
  for select using (is_story_member(story_id));

create policy turns_insert on turns
  for insert with check (is_story_member(story_id));

create policy turns_update on turns
  for update using (is_story_member(story_id)) with check (is_story_member(story_id));

create policy turns_delete on turns
  for delete using (is_story_owner(story_id));

create policy submissions_select on submissions
  for select using (is_story_member(story_id));

-- A member may only submit as themselves, and only while the turn is open.
create policy submissions_insert on submissions
  for insert with check (
    is_story_member(story_id)
    and user_id = (select auth.uid())
    and exists (
      select 1 from turns
      where turns.id = submissions.turn_id
        and turns.status = 'open'
    )
  );

create policy submissions_update on submissions
  for update using (
    user_id = (select auth.uid())
    and exists (
      select 1 from turns
      where turns.id = submissions.turn_id
        and turns.status = 'open'
    )
  ) with check (user_id = (select auth.uid()));

-- No delete policy: submissions must survive every generation outcome.

create trigger turns_touch_updated_at
  before update on turns
  for each row execute function touch_updated_at();

create trigger submissions_touch_updated_at
  before update on submissions
  for each row execute function touch_updated_at();
