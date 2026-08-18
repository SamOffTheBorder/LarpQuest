-- Phase 1: provider keys and cost accounting.
--
-- Cost visibility from day one (build plan Part 11.4). At 8k-token chapters a
-- long campaign is real money, and surprise bills kill products.

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  scope text not null check (scope in ('user', 'story')),
  story_id uuid references stories(id) on delete cascade,
  provider text not null default 'openrouter',
  -- AES-256-GCM ciphertext. The master key lives in the environment and is
  -- never stored here. See apps/web/src/lib/crypto.ts.
  encrypted_key text not null,
  label text,
  created_at timestamptz not null default now(),
  -- A story-scoped key must name its story; a user-scoped key must not.
  constraint api_keys_scope_story check (
    (scope = 'story' and story_id is not null)
    or (scope = 'user' and story_id is null)
  )
);

create index api_keys_owner_idx on api_keys (owner_id);

create table usage_log (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  user_id uuid references auth.users on delete set null,
  role text not null,
  model text not null,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  -- Calls that fail after the provider has already billed tokens are still
  -- logged, so cost reporting is not understated by failures.
  succeeded boolean not null default true,
  used_fallback_model boolean not null default false,
  created_at timestamptz not null default now()
);

create index usage_log_story_idx on usage_log (story_id, created_at);

alter table api_keys enable row level security;
alter table usage_log enable row level security;

-- Keys are never readable by anyone but their owner, and are only ever
-- decrypted server-side. The ciphertext alone is useless without the master
-- key, which is not in the database.
create policy api_keys_select on api_keys
  for select using (owner_id = (select auth.uid()));

create policy api_keys_insert on api_keys
  for insert with check (owner_id = (select auth.uid()));

create policy api_keys_update on api_keys
  for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy api_keys_delete on api_keys
  for delete using (owner_id = (select auth.uid()));

-- Members can see what a story cost. Rows are written by the gateway through
-- the service role, so there is no insert policy for regular callers.
create policy usage_log_select on usage_log
  for select using (story_id is not null and is_story_member(story_id));
