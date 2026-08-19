-- Phase 7: turn_mode_changes — append-only audit trail for a story's active
-- turn mode. entity_history can't hold this: its entity_id is a required FK
-- to a specific entity, and a mode switch is a story-level event with no
-- entity. Same append-only pattern as entity_history/canon_exceptions
-- otherwise: select for any member, insert restricted to owner/gm, no
-- update/delete policy for any non-service-role caller.

create table turn_mode_changes (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  previous_mode text,
  new_mode text not null,
  changed_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index turn_mode_changes_story_idx on turn_mode_changes (story_id, created_at);

alter table turn_mode_changes enable row level security;

create policy turn_mode_changes_select on turn_mode_changes
  for select using (is_story_member(story_id));

create policy turn_mode_changes_insert on turn_mode_changes
  for insert with check (is_story_role(story_id, array['owner', 'gm']));

-- No update or delete policy: append-only, same as entity_history and
-- canon_exceptions.
