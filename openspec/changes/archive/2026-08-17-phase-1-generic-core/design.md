## Context

StoryForge is a greenfield repository. Nothing runs yet: `apps/web` is a bare Next.js App Router scaffold, `docs/` is a Docusaurus site, and there is no database, no auth, and no engine code.

Phase 1 builds the turn loop that every later phase extends. The hard constraint is that the loop must be proven generic *before* the schema system arrives in Phase 2 — if a genre-shaped assumption leaks into the loop now, every later universe pays for it. The build plan's Part 11 also names seven things that must not be deferred; three of them (entity history, submission durability, cost visibility) are Phase 1's responsibility and are the reason this design carries more infrastructure than a minimum-viable turn loop would.

The engine's five layers (Canon, Schema, Entity, Narrative, Context Pool) exist conceptually from the start, but Phase 1 only instantiates three: Entity, Narrative, and the Context Pool. Canon and Schema are placeholders that Phases 2 and 3 fill in.

## Goals / Non-Goals

**Goals:**
- A single user can run ten chapters end to end — the phase's stated exit criterion.
- The turn loop's shape is final. Later phases insert steps (validation, gating, indexing) without restructuring it.
- `assembleContext` has the signature it will keep through Phase 4, so adding retrieval never touches its callers.
- Entity state changes are fully reconstructible from `entity_history` alone.
- A generation failure of any kind is recoverable without data loss.
- Zero conditionals on genre, universe, or media type in engine code.

**Non-Goals:**
- Entity schemas and validation of `data` contents — Phase 2 owns this, and Phase 1 must not pre-empt it with fields that assume a genre.
- Vector retrieval and summarization — Phase 4. The `chapters.embedding` column and `pgvector` extension are not created yet.
- Any second turn mode — Phase 7. The dispatch table exists with one entry.
- Multiplayer concurrency. The turn state machine is single-writer; Phase 5 adds deadlines and locking under contention.
- The validator and gatekeeper loops — Phase 6.

## Decisions

### Postgres via Supabase, with RLS from the first migration

Supabase gives Postgres, auth, `jsonb`, and later `pgvector` and Realtime in one service, which removes the need for a separate auth provider and websocket layer in Phase 5.

RLS is enabled on every table in the migration that creates it, and story-scoped access is gated through a `story_members` lookup even though the owner is the only possible member in Phase 1. *Alternative considered:* enforce access in application code now and add RLS at Phase 5. Rejected — retrofitting policies across a dozen tables while multiplayer semantics are also in flux is where authorization bugs come from. Writing the membership-gated policy once, against a table with one row, costs almost nothing now.

A `security definer` helper (`is_story_member(story_id)`) encapsulates the membership check so policies stay one-liners and Phase 5 changes role logic in a single place.

### Entity `data` stays opaque in Phase 1

Entities are `{type, name, data: jsonb}`. The engine serializes `data` for context and applies diffs to it, but never inspects field names. This is what makes the Phase 2 exit criterion (two structurally different universes on the same code) achievable rather than aspirational.

A GIN index on `data` is created now, since it is cheap and Phase 2's schema-driven queries will want it.

### Diffs are field-level with optimistic concurrency

A diff is `{entity_id, field, from, to, evidence}`. Application requires `from` to match the entity's current value; a mismatch marks the diff conflicted rather than clobbering. *Alternative considered:* whole-object replacement from the extractor. Rejected — it makes `entity_history` useless for understanding *what* changed, and any extractor hallucination silently overwrites unrelated fields. Field-level diffs also give rollback a natural unit.

Rollback writes compensating history rows rather than deleting originals, keeping the ledger append-only and auditable.

### Publish before extract, always

Publication commits the chapter; extraction is a separate job triggered after commit. Extraction failure marks the chapter `extraction_pending` and queues a retry, and never touches publication state. This directly implements Part 11.8, and it also means a slow extractor never makes the reader wait.

Phase 1 uses a simple database-backed retry queue rather than adding Inngest or Trigger.dev. *Rationale:* the durable-jobs dependency earns its place in Phase 3, where the research pipeline genuinely needs multi-step orchestration with progress streaming. Introducing it here to retry a single idempotent call is premature; the queue table is small and the migration path to Inngest is a straight swap of the trigger mechanism.

### Streaming narration with incremental persistence

Narration streams, and accumulated prose is flushed to a draft row periodically rather than only at completion. A timeout therefore leaves recoverable text instead of discarding several thousand tokens of output the user already paid for. This is both a cost and a UX decision — at 4–8k-token chapters, silently discarding a partial generation is real money.

### The gateway is the only place that talks to OpenRouter

All model access goes through one client that takes a role, resolves the model from `model_config`, calls OpenRouter, validates structured output through Zod, and writes `usage_log`. Cost accounting and key decryption cannot be bypassed because there is no other path to the provider.

Zod validation failure retries once with the error fed back into the prompt. *Alternative considered:* unlimited retries until valid. Rejected — a model that fails a schema twice usually fails it persistently, and the build plan caps validation retries at 2 elsewhere for the same reason.

### Keys encrypted with AES-256-GCM, master key in the environment

Per Part 8.3. The application refuses to start without the master key, which prevents the failure mode where keys are written unencrypted because an environment variable was missing. Decryption happens only in server-side code paths; the service-role and provider keys are never in the client bundle.

### Turn state machine is explicit and centrally enforced

Transitions are validated in one module against the permitted set, so `published → generating` cannot happen from a stray call site. `failed` is a first-class state with a retry path that reuses the original submissions.

## Risks / Trade-offs

- **A genre assumption leaks into the loop despite the rule** → The Phase 2 exit criterion is the real test, but it arrives late. Mitigate by seeding two hand-built universes with structurally different entity shapes (one with an abilities array, one with only knowledge and social fields) during Phase 1 testing, so the leak is caught while the loop is still small.
- **Extractor produces plausible but wrong diffs** → Optimistic `from`-matching catches stale writes but not confident hallucinations. Phase 1 accepts this; `entity_history` makes it detectable and reversible, and Phase 6's validator is the real defense. Diffs carry an `evidence` field from the start so a reviewer can check the claim against the prose.
- **No durable job runner means a lost extraction on process death** → The queue is a table, so a crashed worker leaves the row claimable rather than losing it; a stale-claim timeout returns abandoned work to the queue. Bounded risk, and Phase 3 replaces the mechanism.
- **Token budget dropping the wrong content** → Dropping oldest chapters first is a reasonable default but can drop the one chapter that mattered. This is precisely what Phase 4's retrieval fixes; until then the failure is visible (the chapter is simply absent) rather than silent.
- **Single-writer turn assumptions** → Phase 1 assumes one actor per story. Phase 5 must add real locking; the state machine's central enforcement point is where that lock will go, so the change is contained.
- **Supabase lock-in** → Auth, RLS, Realtime, and pgvector are all Supabase-flavored. Accepted deliberately: the alternative is building four subsystems to preserve portability the project does not currently need.

## Migration Plan

Phase 1 creates the initial schema; there is no existing data to migrate.

1. Enable required extensions (`pgcrypto` for `gen_random_uuid`). `vector` is deliberately *not* enabled until Phase 4.
2. Create tables in dependency order: `stories` → `story_members` → `entities` → `entity_history` → `turns` → `submissions` → `chapters` → `extraction_queue` → `api_keys` → `usage_log`.
3. Enable RLS and create policies in the same migration as each table, plus the `is_story_member` helper.
4. Create indexes: GIN on `entities.data`, and `(story_id, turn_number)` on `chapters`.

Rollback is dropping the schema, since no production data exists. From Phase 2 onward, migrations must be forward-only.

Columns from the Part 8.2 schema that belong to later phases (`chapters.embedding`, `stories.universe_id`, `stories.universe_version`) are omitted rather than created nullable, so that Phase 2 and 4 migrations are explicit about introducing them.

## Open Questions

- **Default model strings per role.** The role table is fixed but the specific OpenRouter model for each default is not chosen. Narrator and extractor need defaults for Phase 1; the rest can be placeholders until their phases. Worth deciding against current pricing at implementation time rather than now.
- **Token counting method.** Exact per-model tokenization versus a fast approximation for budget enforcement. An approximation with a safety margin is likely sufficient for Phase 1; revisit if budget errors prove common.
- **World ledger shape.** Held as `stories.world_ledger` jsonb, but whether it is extractor-maintained or hand-maintained in Phase 1 is unresolved. Leaning hand-maintained initially, since extractor-maintained ledgers without validation drift quickly.
- **Partial-generation salvage UX.** Whether a user can publish salvaged partial prose directly or must always regenerate. Affects the turn state machine's `failed` exits.
