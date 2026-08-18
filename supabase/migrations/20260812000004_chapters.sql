-- Phase 1: chapters (the Narrative layer).
--
-- `embedding vector(1536)` and the `vector` extension are deliberately NOT
-- created here. They arrive in Phase 4 with retrieval, so that migration is
-- explicit about introducing them rather than finding a nullable column
-- already sitting there.

create table chapters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  turn_id uuid references turns(id) on delete set null,
  turn_number int not null,
  turn_mode text not null,
  prose text not null,
  summary text,
  entity_ids uuid[] not null default '{}',
  extracted_diffs jsonb,
  validation_report jsonb,
  image_prompts jsonb,
  -- Publication never waits on extraction (build plan Part 11.8). A chapter is
  -- readable the moment it commits; this tracks the follow-up work.
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'complete', 'failed')),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index chapters_story_turn_idx on chapters (story_id, turn_number);
create index chapters_extraction_idx on chapters (extraction_status)
  where extraction_status <> 'complete';

alter table chapters enable row level security;

create policy chapters_select on chapters
  for select using (is_story_member(story_id));

create policy chapters_insert on chapters
  for insert with check (is_story_member(story_id));

create policy chapters_update on chapters
  for update using (is_story_member(story_id)) with check (is_story_member(story_id));

-- Only the owner may unpublish, since it reverses applied state.
create policy chapters_delete on chapters
  for delete using (is_story_owner(story_id));

-- entity_history.chapter_id points here. Declared after chapters exists to
-- avoid a circular dependency between the two migrations.
alter table entity_history
  add constraint entity_history_chapter_fk
  foreign key (chapter_id) references chapters(id) on delete set null;
