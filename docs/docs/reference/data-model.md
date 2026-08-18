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
  published_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (universe_id, version)
);
```

No `classification`, `canon_bible`, `validation_rules`, `context_policy`, `turn_modes`, `research_gaps`, or `is_public` yet — those arrive with the phases that produce or consume them. `progression_model` is singular (Phase 2 registers `none` and `ability_unlock`; a universe picks one), not the `progression_models text[]` the future shape anticipates for universes composing several. See [Universe Versioning](/architecture/universe-versioning) for why versions are separate immutable rows.

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
  turn_config jsonb not null,         -- deadline, absent policy, conflict policy
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
```

`universe_version` is **pinned**, not a live reference. This is what stops a canon edit from retroactively invalidating 40 published chapters.

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

## Narrative

```sql
create table chapters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  turn_number int not null,
  turn_mode text not null,
  prose text not null,
  summary text,
  embedding vector(1536),
  entity_ids uuid[],
  extracted_diffs jsonb,
  validation_report jsonb,
  image_prompts jsonb,
  created_at timestamptz default now()
);

create table arc_summaries (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  from_chapter int, to_chapter int,
  summary text not null,
  embedding vector(1536)
);
```

`embedding` is on the **summary**, not the prose — a summary embeds what the chapter was about, while prose embeds incidental vocabulary. `arc_summaries` implements [long-story compaction](/architecture/context-assembly#long-story-compaction).

## Turns

```sql
create table turns (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  turn_number int not null,
  mode text not null,
  scene_setup text,
  status text default 'open',         -- open|locked|generating|published|failed
  deadline timestamptz,
  created_at timestamptz default now()
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid references turns(id) on delete cascade,
  entity_id uuid references entities(id),
  user_id uuid references auth.users,
  content text not null,
  proposals jsonb,                    -- new capabilities etc.
  submitted_at timestamptz default now()
);
```

Submissions are a **separate table from generation state** by design. No generation outcome — failure, timeout, retry exhaustion — may delete or alter a submission.

## Gatekeeper and canon exceptions

```sql
create table proposals (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  entity_id uuid references entities(id),
  proposal text not null,
  verdict text,
  reasoning text,
  imposed_limits jsonb,
  gm_override boolean default false,
  created_at timestamptz default now()
);

create table canon_exceptions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  rule_id text not null,
  exception_note text not null,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);
```

`canon_exceptions` is what makes a [GM override permanent](/architecture/validation-gatekeeping#gm-override-writes-to-canon).

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

Still deferred, so later migrations are explicit about introducing them:

| Object | Arrives in |
|---|---|
| `chapters.embedding`, `arc_summaries`, `vector` extension | Phase 4 |
| `proposals`, `canon_exceptions` | Phase 6 |
| `universes.is_public`, `forked_from` (marketplace) | Phase 8 |

Phase 1 adds one table not in the original plan — `extraction_queue`, with a claim timestamp and attempt count — because extraction runs after publication and needs stale-claim recovery. Phase 3 introduces Inngest for the research pipeline's genuinely multi-step orchestration, but does **not** migrate `extraction_queue` onto it — that queue's one-shot retryable job has no orchestration need Inngest would improve on, so it keeps its existing claim/update shape.
