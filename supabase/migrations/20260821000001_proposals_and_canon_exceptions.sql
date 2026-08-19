-- Phase 6: proposals (Gatekeeper rulings) and canon_exceptions (GM overrides).
--
-- Both are append-only from the client's perspective: a proposal row is
-- written once by the Gatekeeper call path (service role) and only ever
-- gains gm_override=true afterward via the override action; a canon
-- exception, once written, is never updated or deleted — same pattern as
-- entity_history and story_reports.

create table proposals (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  entity_id uuid references entities(id) on delete set null,
  proposal text not null,
  verdict text check (verdict in ('allow', 'allow_with_limits', 'reject')),
  reasoning text,
  imposed_limits jsonb,
  suggested_alternative text,
  narrative_cost text,
  gm_override boolean not null default false,
  created_at timestamptz not null default now()
);

create index proposals_story_idx on proposals (story_id);

alter table proposals enable row level security;

create policy proposals_select on proposals
  for select using (is_story_member(story_id));

-- No insert/update/delete policy for the anon/authenticated roles: proposals
-- are written by the Gatekeeper call path and the override action, both of
-- which run under the service-role client, same as extraction/memory writes.

create table canon_exceptions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  rule_id text not null,
  entity_id uuid references entities(id) on delete cascade,
  capability_id text,
  exception_note text not null check (length(trim(exception_note)) > 0),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index canon_exceptions_scope_idx
  on canon_exceptions (story_id, rule_id, entity_id, capability_id);

alter table canon_exceptions enable row level security;

create policy canon_exceptions_select on canon_exceptions
  for select using (is_story_member(story_id));

create policy canon_exceptions_insert on canon_exceptions
  for insert with check (is_story_role(story_id, array['owner', 'gm']));

-- No update or delete policy: exceptions are append-only, same as
-- entity_history and story_reports.
