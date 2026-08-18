-- Phase 1: entities and the append-only history ledger.
--
-- `data` is opaque jsonb. The engine serializes it for context and applies
-- diffs to it, but never inspects field names — that is what lets one engine
-- run every genre. Schema enforcement arrives in Phase 2.
--
-- entity_history exists from day one (build plan Part 11.2). Without it,
-- rollback is impossible and debugging state drift is guesswork.

create table entities (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  type text not null,
  name text not null check (length(trim(name)) between 1 and 200),
  data jsonb not null default '{}'::jsonb,
  controlled_by uuid references auth.users on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index entities_story_idx on entities (story_id, status);
create index entities_data_idx on entities using gin (data);

-- Append-only. Rollback writes compensating rows rather than deleting
-- originals, so the ledger stays auditable.
create table entity_history (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  story_id uuid not null references stories(id) on delete cascade,
  chapter_id uuid,
  diff jsonb not null,
  applied_by uuid references auth.users on delete set null,
  is_reversal boolean not null default false,
  created_at timestamptz not null default now()
);

create index entity_history_entity_idx on entity_history (entity_id, created_at);
create index entity_history_chapter_idx on entity_history (chapter_id);

alter table entities enable row level security;
alter table entity_history enable row level security;

create policy entities_select on entities
  for select using (is_story_member(story_id));

create policy entities_insert on entities
  for insert with check (is_story_member(story_id));

create policy entities_update on entities
  for update using (is_story_member(story_id)) with check (is_story_member(story_id));

create policy entities_delete on entities
  for delete using (is_story_owner(story_id));

create policy entity_history_select on entity_history
  for select using (is_story_member(story_id));

create policy entity_history_insert on entity_history
  for insert with check (is_story_member(story_id));

-- No update or delete policy: history is append-only. Absent policies mean
-- those operations are denied for every non-service-role caller.

create trigger entities_touch_updated_at
  before update on entities
  for each row execute function touch_updated_at();
