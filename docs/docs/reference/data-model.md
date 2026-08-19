---
sidebar_position: 2
title: Data Model
---

# Data Model

Postgres via Supabase. `jsonb` for schema-defined data, `pgvector` for retrieval.

:::warning RLS on every table
Enable RLS on every table in the migration that creates it. Access is gated through `story_members`. A table without a policy is a bug, and the migration test suite fails on one.
:::

## Universes

:::info Phase 2 shape vs. the full future shape
This section shows the target shape once [research-derived canon](/phases/build-order#the-eight-stages) (Phase 3), validation rules (Phase 6), and the marketplace (`is_public`, `forked_from`, Phase 8) all exist. What Phase 2 actually created is narrower — see the note below the table.
:::

```sql
create table universes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users,
  name text not null,
  version int not null default 1,
  forked_from uuid references universes(id),
  classification jsonb not null,      -- Stage 1 output
  canon_bible jsonb not null,         -- Stages 2-5 output
  entity_schema jsonb not null,       -- Stage 6 output
  progression_models text[] not null,
  validation_rules jsonb not null,    -- Stage 7 output
  context_policy jsonb not null,
  turn_modes text[] not null,
  research_gaps jsonb,                -- Stage 8 output
  is_public boolean default false,
  created_at timestamptz default now()
);
```

The `jsonb` columns map directly onto [research pipeline](/phases/build-order#the-eight-stages) stages, none of which exist until Phase 3. `version` and `forked_from` implement universe versioning — required from Phase 2, but shaped differently than drawn above.

### What Phase 2 actually created

Identity and versioned content are two tables, not one, because versions are immutable rows rather than a `version` counter mutated in place:

```sql
create table universes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users,
  name text not null,
  created_at timestamptz default now()
);

create table universe_versions (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  version int not null,
  entity_schema jsonb not null,        -- Phase 2: hand-authored; Stage 6 output from Phase 3 on
  progression_model text not null,     -- single slug, Phase 2's dispatch table
  progression_config jsonb not null default '{}',
  context_policy jsonb not null default '{...}',      -- Phase 4, defaulted
  canon_bible_summary jsonb,                            -- Phase 4, nullable
  canon_bible_rules_only jsonb,                         -- Phase 4, nullable
  validation_rules jsonb not null default '[]',         -- Phase 6: Stage 7 rule pack
  published_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (universe_id, version)
);
```

No `classification`, `canon_bible` (the full, uncompressed jsonb the future shape sketches), `turn_modes`, `research_gaps`, or `is_public` yet — those arrive with the phases that produce or consume them. `progression_model` is singular (Phase 2 registers `none` and `ability_unlock`; a universe picks one), not the `progression_models text[]` the future shape anticipates for universes composing several. `context_policy` and the two compressed canon-bible columns arrived in Phase 4 — see [Memory & Context](/architecture/memory-and-context#context-policy) — generated synchronously at publish, from an optional `canonBible` input that `research/publish.ts` does not yet supply (research-created universes currently publish with null compressed variants; wiring the draft's rules/entities/timeline sections into that input remains unscoped). `validation_rules` arrived in Phase 6 — unlike `canonBible`, `research/publish.ts` **does** wire this one through: an accepted-or-edited rule-pack draft section maps directly into it, since the rule engine needs it to evaluate anything beyond the Standard Rule Pack. `create_universe_with_version`/`publish_universe_version` gained a `p_validation_rules` parameter — dropped and recreated, since `create or replace` cannot change a parameter list. See [Universe Versioning](/architecture/universe-versioning) for why versions are separate immutable rows.

## Research drafts

```sql
create table universe_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  status text not null default 'researching'
    check (status in ('researching', 'ready_for_review', 'published')),
  input jsonb not null,                -- name, source_text, canon_cutoff, au_notes
  draft jsonb not null default '{}',   -- accumulating per-stage section document
  universe_id uuid references universes(id),
  published_version int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table research_jobs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references universe_drafts(id) on delete cascade,
  stage text not null,                 -- one of the eight pipeline stages
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed', 'skipped')),
  attempt_count int not null default 0,
  output jsonb,
  previous_output jsonb,               -- one generation back, for the re-run diff view
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (draft_id, stage)
);
```

:::warning The one documented RLS exception
Every other table on this page is gated through `is_story_member()`. `universe_drafts` and `research_jobs` are gated through `owner_id = auth.uid()` instead — a draft exists before any story does, so there is no `story_members` row to check yet. See [Universe Review](/architecture/universe-review#why-drafts-are-owned-by-a-user-not-gated-through-story_members).
:::

A draft's `input` and accumulating `draft` document are `jsonb` rather than relational rows per section — see [Research Pipeline](/architecture/research-pipeline) and [Universe Review](/architecture/universe-review) for the shapes stages write into `draft` and how the review workflow reads them.

## Stories

```sql
create table stories (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id),      -- nullable: a story may have no universe
  universe_version int,                            -- pinned; null iff universe_id is null
  owner_id uuid references auth.users,
  title text not null,
  content_rating text not null,
  model_config jsonb not null,        -- model string per role
  turn_config jsonb not null,         -- deadline, absent policy, conflict policy, active_mode (Phase 7)
  world_ledger jsonb not null default '{}',
  current_turn int default 0,
  status text default 'active',
  created_at timestamptz default now()
);

create table story_members (
  story_id uuid references stories(id) on delete cascade,
  user_id uuid references auth.users,
  role text not null,                 -- owner|gm|player|spectator
  joined_at timestamptz default now(),
  primary key (story_id, user_id)
);

create table story_invites (        -- Phase 5
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  token text not null unique,
  role text not null,                 -- gm|player|spectator (never owner)
  created_by uuid references auth.users,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_uses int,
  use_count int not null default 0,
  created_at timestamptz default now()
);

create table story_reports (        -- Phase 5
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  reporter_id uuid references auth.users,
  chapter_id uuid references chapters(id) on delete cascade,
  submission_id uuid references submissions(id) on delete cascade,
  reason text not null,
  created_at timestamptz default now()
  -- check: exactly one of chapter_id/submission_id is non-null
);
```

`universe_version` is **pinned**, not a live reference. This is what stops a canon edit from retroactively invalidating 40 published chapters.

`stories` also gained a `conflict_policy text` column in Phase 5 (`narrative_priority` default, `initiative_order`, `gm_ruling`, `both_partially_succeed`) — folded into the Narrator prompt, never a code branch. See [Multiplayer](/architecture/multiplayer#conflict-resolution).

`story_members.role` existed from Phase 1, but only `owner` was ever inserted until Phase 5 added `story_invites`/`join_story_via_invite` as the only path for a second user to join. `entities_update` and `story_members_delete` RLS were narrowed in Phase 5 — see [Multiplayer](/architecture/multiplayer#roles-and-authorization).

## Entities

```sql
create table entities (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  type text not null,                 -- from entity_schema
  name text not null,
  data jsonb not null,                -- conforms to entity_schema
  controlled_by uuid references auth.users,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table entity_history (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities(id) on delete cascade,
  chapter_id uuid,
  diff jsonb not null,
  applied_by uuid references auth.users,
  created_at timestamptz default now()
);
```

:::tip entity_history is required from Phase 1
Every state change is a row. Without it, rollback is impossible and debugging state drift is guesswork. History is append-only — rollback writes *compensating* rows rather than deleting originals.
:::

Entity state must be fully reconstructible by replaying `entity_history` alone.

`controlled_by` existed since Phase 1 but was schema-only until Phase 5 started reading and enforcing it — see [Multiplayer](/architecture/multiplayer#entity-claiming). A manual edit now requires being the entity's controller, or `owner`/`gm`.

## Narrative

```sql
create table chapters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  turn_number int not null,
  turn_mode text not null,
  prose text not null,
  summary text,
  embedding vector(1536),           -- Phase 4
  entity_ids uuid[],
  extracted_diffs jsonb,
  validation_report jsonb,          -- Phase 6: flags from evaluateRules, empty array means "evaluated, clean," null means unevaluated (pre-Phase-6)
  image_prompts jsonb,              -- Phase 8
  extraction_status text not null default 'pending',  -- Phase 1
  memory_status text not null default 'pending',       -- Phase 4
  created_at timestamptz default now()
);

create table arc_summaries (       -- Phase 4
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  from_chapter int not null, to_chapter int not null,
  summary text not null,
  embedding vector(1536),
  created_at timestamptz default now()
);

create table memory_queue (        -- Phase 4
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references chapters(id) on delete cascade,
  story_id uuid references stories(id) on delete cascade,
  status text not null default 'queued',  -- queued|claimed|complete|failed
  attempt_count int not null default 0,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (chapter_id)
);
```

`embedding` is on the **summary**, not the prose — a summary embeds what the chapter was about, while prose embeds incidental vocabulary. `arc_summaries` implements [long-story compaction](/architecture/memory-and-context#arc-compaction). `memory_queue` mirrors `extraction_queue`'s shape exactly (own table, not a job-type column on the existing one) since summary/embedding generation and diff extraction are independent failure domains — see [Memory & Context](/architecture/memory-and-context#per-chapter-memory-generation).

## Turns

```sql
create table turns (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  turn_number int not null,
  mode text not null,
  scene_setup text,
  status text default 'open',         -- open|locked|generating|validating|published|failed (Phase 6 added validating)
  deadline timestamptz,               -- unused until Phase 5's deadline sweep
  moderation_status text,             -- Phase 5: pass|flag|block
  moderation_reason text,             -- Phase 5
  created_at timestamptz default now()
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid references turns(id) on delete cascade,
  entity_id uuid references entities(id),
  user_id uuid references auth.users,
  content text not null,
  proposals jsonb,                    -- Phase 6: {text: string} when the player submitted a proposal; the submissionInputSchema field is `proposal`, singular
  submitted_at timestamptz default now()
);
```

Submissions are a **separate table from generation state** by design. No generation outcome — failure, timeout, retry exhaustion — may delete or alter a submission.

`turns.deadline` was present from Phase 1's original migration but read by nothing until Phase 5's `sweepDeadlines`. `moderation_status`/`moderation_reason` record the once-per-turn moderation pass Phase 5 added — see [Multiplayer](/architecture/multiplayer#moderation). `turns.mode` (present since Phase 1) is fixed at creation and never changes afterward — see `turn_mode_changes` below for how the *story's* mode changes between turns.

## Turn mode changes

```sql
create table turn_mode_changes (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  previous_mode text,
  new_mode text not null,
  changed_by uuid references auth.users,
  created_at timestamptz not null default now()
);
```

Phase 7's audit trail for `stories.turn_config.active_mode`. Append-only, same shape as `entity_history`, but without an `entity_id` — a mode switch is a story-level event with no entity to attach to. `openTurn` reads `turn_config.active_mode` fresh at the moment a new turn is created, so a switch takes effect starting with the next turn opened; it never touches any `turns` row already written. See [Turn Modes](/architecture/turn-modes#mode-switching).

## Gatekeeper and canon exceptions

```sql
create table proposals (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
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

create table canon_exceptions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  rule_id text not null,
  entity_id uuid references entities(id) on delete cascade,
  capability_id text,
  exception_note text not null,
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);
```

`entity_id`/`capability_id` on `canon_exceptions` are a superset of the build plan's minimal `rule_id` + `exception_note` sketch — both null is still a valid row and means "suppress this rule for the whole story," which is also how a universe disables one Standard Rule Pack rule entirely. `canon_exceptions` is what makes a [GM override permanent](/architecture/validation-gatekeeping#gm-override-writes-to-canon); `proposals` rows are written by the Gatekeeper (service-role only — no client insert policy) and only ever gain `gm_override = true` afterward, never a changed `verdict`/`reasoning`.

## Keys and usage

```sql
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users,
  scope text not null,                -- user|story
  story_id uuid references stories(id),
  encrypted_key text not null,
  created_at timestamptz default now()
);

create table usage_log (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id),
  user_id uuid references auth.users,
  role text not null,                 -- which model role
  model text not null,
  prompt_tokens int, completion_tokens int,
  cost_usd numeric(10,6),
  created_at timestamptz default now()
);
```

## Indexes

```sql
create index on chapters using ivfflat (embedding vector_cosine_ops);
create index on arc_summaries using ivfflat (embedding vector_cosine_ops);
create index on entities using gin (data);
create index on chapters (story_id, turn_number);
```

## What exists by phase

Phase 1 created: `stories`, `story_members`, `entities`, `entity_history`, `turns`, `submissions`, `chapters`, `extraction_queue`, `api_keys`, `usage_log`.

Phase 2 added: `universes`, `universe_versions`, and nullable `stories.universe_id` / `stories.universe_version` (composite FK into `universe_versions`). Both new columns are unbackfilled — a story created before Phase 2, or created without a universe, keeps them null permanently, not as a transitional state.

Phase 3 added: `universe_drafts`, `research_jobs`, and the `start_research_job` RPC. No existing table changed.

Phase 4 added: the `vector` extension (in a dedicated `extensions` schema, not `public`), `chapters.embedding`/`memory_status`, `arc_summaries`, `memory_queue`, `universe_versions.context_policy`/`canon_bible_summary`/`canon_bible_rules_only`. New RPCs: `claim_memory_job`, `match_chapter_summaries`, `match_arc_summaries`. `create_universe_with_version` and `publish_universe_version` gained new parameters — this required dropping and recreating both functions, since `create or replace` cannot change a parameter list.

Phase 5 added: `story_invites`, `story_reports`, `stories.conflict_policy`, `turns.moderation_status`/`moderation_reason`. New RPCs: `join_story_via_invite`; new policy helper `is_story_role` (mirrors `is_story_owner`'s shape, both revoked from direct client execution). `entities_update` and `story_members_delete` RLS policies were narrowed (dropped and recreated) rather than replaced with new tables.

Phase 6 added: `proposals`, `canon_exceptions`, `universe_versions.validation_rules`. `turns.status` check constraint widened to add `'validating'`. `chapters.validation_report` (present since Phase 1, unpopulated) is now written on every publish. `publish_chapter` was dropped and recreated — its guard moved from `generating` to `validating`, and it gained a `p_validation_report` parameter. `create_universe_with_version`/`publish_universe_version` gained a `p_validation_rules` parameter, dropped and recreated for the same "can't change a parameter list" reason as Phase 4's canon-bible params.

Phase 7 added: `turn_mode_changes`. No column added to `stories` — `turn_config.active_mode` is a new key within the existing jsonb column, unbackfilled (absent means "never switched," read as `freeform`). `turn-modes.ts`'s dispatch table gained five entries (`action`, `scene`, `investigation`, `dialogue`, `montage`); no schema change was needed for the modes themselves, only for the switching audit trail.

Still deferred, so later migrations are explicit about introducing them:

| Object | Arrives in |
|---|---|
| `universes.is_public`, `forked_from` (marketplace), `image_prompts` (populated) | Phase 8 |

Phase 1 adds one table not in the original plan — `extraction_queue`, with a claim timestamp and attempt count — because extraction runs after publication and needs stale-claim recovery. Phase 3 introduces Inngest for the research pipeline's genuinely multi-step orchestration, but does **not** migrate `extraction_queue` onto it — that queue's one-shot retryable job has no orchestration need Inngest would improve on, so it keeps its existing claim/update shape. Phase 4 follows the same precedent for `memory_queue`: a new independent job kind gets its own table, not a type column on `extraction_queue`.
