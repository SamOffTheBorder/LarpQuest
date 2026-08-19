## Context

`apps/web/src/lib/engine/turn-modes.ts` implements a `Record<string, TurnMode>` dispatch table (`TURN_MODES`) with exactly one entry, `FREEFORM`, registered under `resolveTurnMode`. The turn loop (`turns.ts`) calls `resolveTurnMode(turn.mode)` and never branches on the result's identity — it only calls `mode.systemPrompt(...)` and reads `mode.extractionTargets`. `turns.ts:210-223` (the turn-creation path) already persists `mode` per-turn at creation time, currently always sourced from `DEFAULT_TURN_MODE` (`'freeform'`) via `options.mode ?? DEFAULT_TURN_MODE`, with no caller ever passing a non-default value. `stories.turn_config` is an existing `jsonb not null default '{}'::jsonb` column (`20260812000001_stories_and_members.sql:17`) already read for `absent_policy` (`deadlines.ts`) and, per the build plan's turn-config concept, is the natural home for an `active_mode` key rather than a new column.

`entity_history` (`20260812000002_entities_and_history.sql:27-36`) is not reusable for mode-switch auditing: `entity_id uuid not null references entities(id)` is a required FK to a specific entity, and a mode switch is a story-level event with no entity. This design adds a small dedicated table following the identical append-only pattern instead of forcing an entity relationship that doesn't exist.

Investigation mode's "information gated by clue graph" (Part 9) is the one mode with behavior beyond prompt text. Phase 2's Entity Schema already supports arbitrary universe-defined entity types with jsonb `data`; a universe wanting investigation mode defines its own clue/knowledge-state entity type through that existing mechanism. No new schema concept is needed — only a narrator-context convention for how `investigation` mode's system prompt instructs the model to gate reveals by the player-entity's tracked knowledge state field.

## Goals / Non-Goals

**Goals:**
- Register `action`, `scene`, `investigation`, `dialogue`, `montage` in `TURN_MODES`, each per its Part 9 row (player submission shape, narrator objective, extraction focus).
- Let `owner`/`gm` change a story's active mode between turns, auditable and effective from the next turn only.
- Make the extraction worker demonstrably vary its attention by the *turn's* stored mode (not the story's current default), since `turns.mode` is already captured per-turn.
- Keep `turns.ts` and `extraction-worker.ts` free of any new conditional on mode identity — both already dispatch through `resolveTurnMode`; this phase must not regress that.

**Non-Goals:**
- No new progression models, validator/gatekeeper changes, or research-pipeline stages (see proposal Non-goals).
- No automatic/AI-driven mode switching — manual GM action only.
- No retroactive mode change to existing turns.
- No new entity-schema mechanism for clue graphs — reuse Phase 2's schema system as-is.

## Decisions

**1. Active mode lives in `stories.turn_config.active_mode`, not a new column.**
`turn_config` already exists, is already read as a loose jsonb bag (`absent_policy`), and already has the exact shape needed: story-level turn policy that isn't part of the structural schema. Adding `active_mode` there avoids a migration touching `stories`' column list and keeps all turn-policy knobs in one place. Alternative considered: a dedicated `stories.active_turn_mode text` column — rejected because it fragments turn policy across two storage locations for no query benefit (mode is only read at turn-creation time, never filtered/joined on).

**2. New `turn_mode_changes` table for the audit trail, not a stretch of `entity_history`.**
Mirrors `entity_history`'s exact append-only shape (`id, story_id, previous_mode, new_mode, changed_by, created_at`) but without the mandatory `entity_id`. Same RLS pattern: `select` for `is_story_member`, `insert` for `is_story_member` (or narrowed to owner/gm — see below), no update/delete policy. Alternative considered: make `entity_history.entity_id` nullable and repurpose it — rejected; that weakens a column that's load-bearing everywhere else (rollback logic keys off it) for one narrow use, violating the "don't add flexibility beyond what's needed" instinct in reverse — it would make an existing, working table looser to avoid adding one small new table.

**3. Mode switch is `owner`/`gm`-only, enforced the same way `canon_exceptions` overrides are (Phase 6 precedent).**
`insert` RLS policy on `turn_mode_changes` checks `is_story_owner_or_gm(story_id)` (new helper, or reuse whatever Phase 6's GM-override check used — confirm exact helper name in `canon-exceptions` capability code before implementing) rather than the broader `is_story_member`. Application code in `mode-switching.ts` performs the same check before writing, so a rejected write fails fast with a typed error rather than relying solely on an RLS denial surfacing as a generic Postgres error.

**4. Effective-from-next-turn semantics via read-at-creation, not a pending-change queue.**
`turns.ts`'s turn-creation path changes from `options.mode ?? DEFAULT_TURN_MODE` to `options.mode ?? story.turn_config.active_mode ?? DEFAULT_TURN_MODE`. Because `turn_config.active_mode` is read fresh at the moment a new turn opens, a switch recorded at any point before the next turn opens takes effect then, automatically, with no separate "pending mode" state to manage. A turn already `open`/`generating` when the switch happens is unaffected because its `mode` was already written to the `turns` row at its own creation.

**5. `investigation` mode's clue-gating is a prompt-level instruction, not an engine mechanism.**
The `systemPrompt` function for `investigation` instructs the narrator model to only reveal information the active player-entities' tracked knowledge-state field (a universe-defined schema field, read the same way any other entity data is read into context) supports — phrased generically ("only reveal information this entity's tracked knowledge state qualifies it for"), with zero reference to what that field is actually called in any given universe. This keeps the engine's zero-genre-conditionals rule intact: the gating logic lives entirely in the model's instructions plus whatever schema the universe already defined, never in a new TypeScript branch.

**6. Extraction worker keys off `turn.mode`, confirmed via test, not new code if already correct.**
Read `extraction-worker.ts` during implementation before assuming a change is needed — `turn-modes.ts`'s `TurnMode.extractionTargets` field already exists and per its own doc comment is "opaque strings — the engine passes them to the extractor and never interprets them," suggesting the wiring may already be mode-generic. This phase's job is to add a test proving multiple distinct target lists actually reach the extractor differently once `action`/`scene`/etc. exist, and fix the call site only if that test fails.

## Risks / Trade-offs

- **Five new prompt templates is a lot of prose to get right without genre leakage.** → Each mode's `systemPrompt` is reviewed against the same rule `freeform`'s already follows: describe the *shape* of the turn (what's submitted, what's produced) generically, never name a genre concept. Use the Part 9 table's own wording ("Line of inquiry", "Time skip") as the ceiling for specificity.
- **`turn_config.active_mode` defaulting**: an existing story with `turn_config: {}` (pre-Phase-7) must keep behaving as `freeform` after this ships. → `options.mode ?? story.turn_config.active_mode ?? DEFAULT_TURN_MODE` already handles this: absent key falls through to the existing default, no migration/backfill needed.
- **Race between two GMs switching mode simultaneously** → Last-write-wins is acceptable (matches how `world_ledger` and other jsonb story fields are already updated); the audit row makes the actual sequence reconstructable regardless.
- **A universe with no clue/knowledge-state entity field enables `investigation` mode anyway** → Not blocked at the engine level (would require schema-aware validation the engine doesn't do elsewhere either); the narrator prompt's instruction is simply inert if no such field exists, degrading gracefully to normal reveal behavior rather than erroring.

## Migration Plan

1. Migration: `stories.turn_config` needs no schema change (jsonb, key added at the application level). Add `turn_mode_changes` table with RLS (owner/gm insert, member select, no update/delete) in a new migration following the `entity_history` pattern.
2. `turn-modes.ts`: add five `TurnMode` entries and register in `TURN_MODES`. Purely additive — no existing entry changes.
3. `turns.ts`: change turn-creation's mode source as in Decision 4. Add `mode-switching.ts` with the write path + role check.
4. Verify/adjust `extraction-worker.ts` per Decision 6.
5. Run `supabase db push` (linked project — no local Docker per this repo's constraints), then `supabase db advisors --linked` and the RLS coverage test file to confirm the new table's policies are correct before trusting them.
6. Docs updates (architecture + phase page + sidebar), per proposal Impact.

Rollback: the new table and `turn_config.active_mode` key are additive and unused by any pre-Phase-7 code path; dropping the table and reverting `turn-modes.ts`/`turns.ts` fully reverses the change with no data-loss risk to existing stories.

## Open Questions

- Exact name of the existing owner/gm-check helper used by Phase 6's `canon-exceptions` override RLS/application check — reuse it rather than inventing a second one. Confirm during implementation by reading that capability's code.
- Whether `montage`'s "progression across a span" extraction target needs any new extractor-side aggregation logic beyond passing a different `extractionTargets` list, or whether the existing extractor is already generic enough (per Decision 6, default to assuming it is until a test proves otherwise).
