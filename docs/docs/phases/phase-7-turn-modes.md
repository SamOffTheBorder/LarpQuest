---
sidebar_position: 8
title: Phase 7 — Turn Modes
---

# Phase 7 — Turn Modes

**Status:** Implemented
**Spec location:** `openspec/changes/phase-7-turn-modes/`

Phase 7 is build plan Part 10. Phase 6 (Validation & Gatekeeping) is implemented and archived. Before this phase the turn mode dispatch table (`apps/web/src/lib/engine/turn-modes.ts`) registered exactly one mode, `freeform`, exactly as Phase 1 specified. Build plan Part 9 defines five more — `action`, `scene`, `investigation`, `dialogue`, `montage` — each with a distinct player-submission shape, narrator objective, and extraction focus, and states that a story should be able to switch between them mid-run. Part 12's three launch universe templates each depend on specific mode pairs that did not exist before this phase.

**Exit criteria (Part 9):** A story can run `scene` for setup, `investigation` through the middle, and `action` for the climax — the same story, switching mid-run, with no code change required to add a mode.

## What shipped

- **Five new turn modes** — `action`, `scene`, `investigation`, `dialogue`, `montage` — each a new entry in the same `TURN_MODES` dispatch table `freeform` has used since Phase 1. Adding them required zero changes to the turn loop, the extraction worker's call site, or `resolveTurnMode`/`registeredTurnModes` — exactly the property the dispatch table was built to guarantee.
- **Mode-aware extraction, confirmed** — the extraction worker already read a chapter's own stored `turn_mode` and resolved its `extractionTargets` generically; this phase added a test proving two turns in different modes actually produce different extractor prompts, since Phase 1–6 only ever exercised `freeform`.
- **Mid-story mode switching** — `switchTurnMode(storyId, userId, newMode)`, owner/GM only, updates `stories.turn_config.active_mode` and writes an append-only `turn_mode_changes` audit row. A switch takes effect starting with the next turn opened; every turn already created keeps the mode it was created with, since `turns.mode` is fixed at creation and a switch never touches an existing `turns` row.
- **Investigation mode's clue-gating** — a prompt-level instruction telling the narrator to reveal only what the acting entity's tracked knowledge-state field supports, phrased with zero reference to any specific universe's vocabulary. No new schema mechanism: a universe wanting this defines its own knowledge-state field the same way it defines any other Entity Schema field (Phase 2). A universe without one simply makes the instruction inert.

## What does not ship

No new progression models. No changes to the Phase 6 validator/gatekeeper loop — modes plug into the existing `gatekeeperRulings` prompt-injection point exactly as `freeform` already did. No new research-pipeline stages. No automatic or AI-driven mode selection — switching is a manual owner/GM action only. No retroactive mode change to already-created turns. No UI design pass (Phase 8).

## Capabilities specified

| Capability | Covers |
|---|---|
| `turn-modes-extended` | The five new `TurnMode` registrations — prompt templates and extraction targets per Part 9 |
| `mode-switching` | Owner/GM-gated mid-story mode switch, append-only audit trail, effective-from-next-turn semantics |
| `turn-loop` (modified) | A turn's mode resolves from the story's active mode at creation time, not a hardcoded default |

## Key design decisions

### Active mode lives in `turn_config.active_mode`, not a new column

`stories.turn_config` already existed and was already read as a loose jsonb bag (Phase 5's `absent_policy`). Mode is only ever read at turn-creation time — never filtered or joined on — so a new jsonb key costs nothing a dedicated column would buy back.

### A dedicated `turn_mode_changes` table, not a stretch of `entity_history`

`entity_history.entity_id` is a required foreign key to a specific entity. A mode switch is a story-level event with no entity. Rather than making `entity_id` nullable and weakening a column that's load-bearing for rollback everywhere else, this phase adds one small table with the identical append-only shape and RLS pattern.

### Effective-from-next-turn via read-at-creation, not a pending-change queue

`openTurn` reads `turn_config.active_mode` fresh at the moment a new turn opens. A switch recorded at any point before that read simply takes effect then — there is no separate "pending mode" state to manage, and a turn already in flight when a switch happens is unaffected because its `mode` was already written at its own creation.

### Investigation mode's gating is a prompt instruction, not an engine mechanism

Keeping the clue-graph concept out of TypeScript is what keeps the "zero genre conditionals in engine code" rule intact. The gating logic lives entirely in the model's instructions plus whatever schema field a universe already defined for tracking what a character knows.

## Database objects

New: `turn_mode_changes` (story_id, previous_mode, new_mode, changed_by, created_at) — append-only, RLS insert restricted to `is_story_role(story_id, array['owner','gm'])`, select for any member, no update/delete policy. No column added to `stories`; `turn_config.active_mode` is a new jsonb key, unbackfilled.

→ [Full data model](/reference/data-model)

## Verifying the phase

- `engine/turn-modes.test.ts` — all six modes produce non-empty, distinct prompts; content-rating/conflict-policy injection and Gatekeeper-ruling injection still work for every mode; investigation mode's gating instruction present regardless of universe schema
- `engine/turns.test.ts` — a turn opened without an explicit mode adopts the story's active mode; defaults to `freeform` when unset; explicit mode still overrides; unregistered active mode rejected
- `engine/mode-switching.test.ts` — owner/GM switch succeeds and preserves unrelated `turn_config` keys; player rejected with nothing written; unregistered mode rejected with nothing written; previous/new mode chains correctly across successive switches; history readable by any member
- `engine/extraction-worker.test.ts` — an `action`-mode chapter and a `dialogue`-mode chapter produce distinct extractor prompts carrying their own `extractionTargets`
- `engine/phase-7-exit-criterion.test.ts` — the full arc: a story opens in `scene`, switches to `investigation`, opens again, switches to `action`, opens again; every turn keeps the mode active at its own creation; every switch is audited; a player cannot switch
- `npm test` (371/371 passing), `npm run typecheck`, `npm run build` all pass from `apps/web`; `supabase db advisors --linked` and the RLS coverage test both clean after the migration

## Working the phase

```bash
openspec show phase-7-turn-modes
openspec status --change phase-7-turn-modes
openspec validate phase-7-turn-modes --strict
```

→ [Spec workflow](/reference/spec-workflow)
→ [Turn Modes architecture](/architecture/turn-modes)
