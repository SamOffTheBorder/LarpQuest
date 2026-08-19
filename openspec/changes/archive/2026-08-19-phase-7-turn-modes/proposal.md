## Why

Phase 6 (Validation & Gatekeeping) is complete and archived. Part 10 of `STORYFORGE_BUILD_PLAN.md` puts Turn Modes next. Today `apps/web/src/lib/engine/turn-modes.ts` registers exactly one mode, `freeform`, exactly as Phase 1 specified — every story, regardless of what kind of scene is actually happening, gets the same generic narrator prompt and the same generic extraction targets. Part 9 of the build plan defines five more modes (`action`, `scene`, `investigation`, `dialogue`, `montage`), each with a distinct player-submission shape, narrator objective, and extraction focus, and states that a story should be able to switch between them mid-run ("A story might run `scene` for setup, `investigation` for the middle, `action` for the climax"). Part 12's three launch universe templates each depend on specific mode pairs (`action`+`montage`, `investigation`+`dialogue`, `dialogue`+`scene`) that do not exist yet. Without this phase, none of the launch templates can actually run as designed, and there is no way for a GM to change how a story plays as its story shape changes.

## What Changes

- **Five new turn modes** registered in the existing `TURN_MODES` dispatch table in `turn-modes.ts` — `action`, `scene`, `investigation`, `dialogue`, `montage` — each contributing a `systemPrompt` function and an `extractionTargets` list per the Part 9 table. Each mode is a new entry in the table, exactly as the file's own header comment describes; the turn loop (`turns.ts`) calls `resolveTurnMode(turn.mode)` today and requires zero changes to accommodate new entries.
- **Mid-story mode switching**: a new write path letting `owner`/`gm` members change a story's active turn mode between turns. The new mode takes effect starting with the next turn opened; turns already generated or in flight keep the mode they were created with (`turns.mode` is already captured per-turn at creation, per `turns.ts:210-223`, so history is naturally preserved without extra bookkeeping). The switch itself writes an `entity_history`-style audit row so "why did the story change shape on turn 14" is always answerable.
- **Mode-aware extraction**: the extractor already receives a mode's `extractionTargets` as opaque strings (per the `TurnMode` interface) — this phase is the first time more than one distinct target list exists, so this change verifies the extraction worker actually varies its attention by the active turn's stored `mode`, not just the story's current default.
- **Investigation mode's clue-gating**: `investigation` is the one mode in Part 9 with a structural dependency beyond prompt text — "Information gated by clue graph." This phase adds the minimal generic hook for that: a universe-defined, schema-driven clue/knowledge-state entity shape (already representable under Phase 2's Entity Schema — no new entity kind) and a narrator-context rule that only reveals information the player's tracked knowledge state qualifies them for. This is data-driven off the entity's own state, not a new engine concept.

## Capabilities

### New Capabilities
- `turn-modes-extended`: the five new `TurnMode` registrations (`action`, `scene`, `investigation`, `dialogue`, `montage`) — prompt templates and extraction targets per Part 9, registered in the existing dispatch table with no change to how the table is consumed.
- `mode-switching`: the write path for changing a story's active turn mode mid-story, `owner`/`gm`-gated per the existing `member-roles` capability, with an append-only audit row and a defined effective-from-next-turn semantics.

### Modified Capabilities
- `turn-loop`: `turns.ts`'s `openTurn`-equivalent path already accepts a `mode` option (`turns.ts:210-223`) sourced from `DEFAULT_TURN_MODE`; this phase changes the source to "the story's currently active mode" (settable via `mode-switching`) rather than always the hardcoded default, and documents that a turn's `mode` is fixed at creation and immutable afterward.

## Non-goals

- No new progression models — Phase 7 is turn modes only, per Part 10's fixed build order. `ability_unlock` and `none` remain the only two progression models.
- No changes to the validator/gatekeeper loop from Phase 6 — modes plug into the existing `gatekeeperRulings` prompt-injection point in `TurnModeStoryContext` (`turn-modes.ts:19-24`) exactly as `freeform` does today; no new validation concepts.
- No new universe research-pipeline stages. A universe's clue graph / knowledge-state entities are authored the same way any other Phase 2 schema-defined entity is; this phase does not touch the research pipeline.
- No automatic mode selection or AI-driven mode suggestions. Mode switching is a manual `owner`/`gm` action only.
- No retroactive mode change to already-created turns. Switching only affects turns opened after the switch.
- No UI design pass — Phase 8 owns visual polish. This phase's UI surface (a mode selector for the GM) uses existing shadcn/ui components with no new design system work.

## Impact

- **Schema**: a migration adding the active-mode column/field to `stories` if not already covered by `stories.turn_config` (confirm during design whether `turn_config.mode` can be updated in place or needs a dedicated column for clean history), plus an `entity_history`-shaped audit row (or reuse of `entity_history` itself, scoped to the story rather than an entity, if the existing table's shape permits) recording each mode switch: previous mode, new mode, changed_by, changed_at, effective_from_turn.
- **Code**: `apps/web/src/lib/engine/turn-modes.ts` gains five new `TurnMode` entries; a new `apps/web/src/lib/engine/mode-switching.ts` (or similar) owns the switch write path and role check; `apps/web/src/lib/engine/turns.ts` changes its mode-resolution source from the hardcoded default to the story's active mode; `apps/web/src/lib/engine/extraction-worker.ts` is verified/adjusted to key off the per-turn stored `mode`'s `extractionTargets`.
- **Model roles**: no new roles — `narrator` and `extractor` are reused with mode-varied prompts/targets, matching every existing mode.
- **Docs**: new `docs/docs/architecture/turn-modes.md`, `docs/docs/phases/phase-7-turn-modes.md`, sidebar and build-order/data-model reference updates.
