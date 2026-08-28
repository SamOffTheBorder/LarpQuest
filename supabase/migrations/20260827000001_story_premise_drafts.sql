-- Phase 8: story premise drafts.
--
-- A premise draft exists before the story it describes — the GM is still
-- deciding whether to create one at all. There is therefore no story to gate
-- access through, so RLS here is owner_id = auth.uid() rather than the
-- is_story_member() pattern most tables use. This is the same documented
-- exception universe_drafts takes (migration 20260818000001) and for the same
-- reason: the object being protected genuinely has no story yet. Once the
-- draft is approved, the story it produced is owned exactly like any other
-- story, through story_members.
--
-- The draft is retained after approval (status 'approved', story_id set)
-- rather than deleted, so "how was this story created?" stays answerable.
-- The (owner_id, created_at desc) index supports both the owner's own listing
-- and any later retention policy over abandoned drafts.

create table story_premise_drafts (
  id uuid primary key default gen_random_uuid(),
  -- set null rather than cascade: account deletion preserves the draft as an
  -- orphan instead of failing, matching how stories.owner_id was reworked in
  -- migration 20260824000004.
  owner_id uuid references auth.users on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'abandoned')),
  input jsonb not null,
  premise jsonb not null default '{}'::jsonb,
  notes text,
  story_id uuid references stories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index story_premise_drafts_owner_idx
  on story_premise_drafts (owner_id, created_at desc);

alter table story_premise_drafts enable row level security;

create policy story_premise_drafts_select on story_premise_drafts
  for select using (owner_id = (select auth.uid()));

create policy story_premise_drafts_insert on story_premise_drafts
  for insert with check (owner_id = (select auth.uid()));

create policy story_premise_drafts_update on story_premise_drafts
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy story_premise_drafts_delete on story_premise_drafts
  for delete using (owner_id = (select auth.uid()));

create trigger story_premise_drafts_touch_updated_at
  before update on story_premise_drafts
  for each row execute function touch_updated_at();
