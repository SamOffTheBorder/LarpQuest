-- Phase 5: reporting and the story-level conflict resolution policy.

create table story_reports (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  reporter_id uuid references auth.users on delete set null,
  chapter_id uuid references chapters(id) on delete cascade,
  submission_id uuid references submissions(id) on delete cascade,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  constraint story_reports_target_check check (
    (chapter_id is not null and submission_id is null)
    or (chapter_id is null and submission_id is not null)
  )
);

create index story_reports_story_idx on story_reports (story_id);

alter table story_reports enable row level security;

create policy story_reports_select on story_reports
  for select using (is_story_role(story_id, array['owner', 'gm']));

create policy story_reports_insert on story_reports
  for insert with check (
    is_story_member(story_id)
    and reporter_id = (select auth.uid())
  );

-- No update or delete policy: reports are append-only, same as entity_history.

alter table stories
  add column conflict_policy text not null default 'narrative_priority'
    check (conflict_policy in ('narrative_priority', 'initiative_order', 'gm_ruling', 'both_partially_succeed'));
