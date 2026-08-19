## 1. Database: turn_mode_changes table

- [x] 1.1 `supabase/migrations/20260822000001_turn_mode_changes.sql`: `turn_mode_changes` table — `id uuid pk default gen_random_uuid()`, `story_id uuid not null references stories(id) on delete cascade`, `previous_mode text`, `new_mode text not null`, `changed_by uuid references auth.users on delete set null`, `created_at timestamptz not null default now()`. Index on `(story_id, created_at)`.
- [x] 1.2 Same migration: enable RLS. `select` policy via `is_story_member(story_id)`. `insert` policy via `is_story_role(story_id, array['owner','gm'])` (confirmed signature from `20260821000001_proposals_and_canon_exceptions.sql`). No update/delete policy — append-only, matching `entity_history`.
- [x] 1.3 `supabase db push --linked` applied; `supabase db advisors --linked` clean (only the two pre-existing accepted warnings); `turn_mode_changes` added to `supabase/tests/rls_coverage.sql`'s append-only table list; `supabase db query --linked --file supabase/tests/rls_coverage.sql` passes with no exceptions.
- [x] 1.4 Regenerated `apps/web/src/lib/supabase/database.types.ts` via `npm run db:types` — `turn_mode_changes` present.

## 2. Five new turn modes

- [x] 2.1 `apps/web/src/lib/engine/turn-modes.ts`: added `actionSystemPrompt`/`ACTION`, `sceneSystemPrompt`/`SCENE`, `investigationSystemPrompt`/`INVESTIGATION`, `dialogueSystemPrompt`/`DIALOGUE`, `montageSystemPrompt`/`MONTAGE`. Refactored the shared content-rating/conflict-policy/gatekeeper-ruling tail into `policyAndRulingLines()`, reused by all six modes including `freeform`.
- [x] 2.2 Same file: `extractionTargets` per mode set exactly as specified.
- [x] 2.3 Same file: all five registered in `TURN_MODES`. `resolveTurnMode`/`registeredTurnModes`/`UnknownTurnModeError` untouched.
- [x] 2.4 `apps/web/src/lib/engine/turn-modes.test.ts`: added a `Phase 7 turn modes` describe block — non-empty prompt/targets per mode, policy injection still works, gatekeeper rulings still appended, all six modes produce distinct prompt text, investigation-mode gating-instruction assertion. `registeredTurnModes` test updated to expect all six. 28/28 passing.
- [x] 2.5 `genre-agnosticism.test.ts` passes unmodified (2/2) — no genre-specific token in any new prompt.

## 3. Story active mode + turn-loop default

- [x] 3.1 `apps/web/src/lib/engine/turns.ts`: `openTurn` now reads `stories.turn_config` (small dedicated select, only when `options.mode` is not passed) and resolves the mode via a new shared `readActiveMode()` helper in `turn-modes.ts`, falling back to `DEFAULT_TURN_MODE`. `resolveTurnMode(mode)` still rejects an unregistered value before writing.
- [x] 3.2 `apps/web/src/lib/engine/turns.test.ts`: added a `turn mode resolution on open` describe block — active mode used when set; defaults to freeform when unset; explicit `options.mode` overrides; unregistered active mode rejected. 25/25 passing (4 new).

## 4. Mode switching

- [x] 4.1 `apps/web/src/lib/engine/mode-switching.ts`: `switchTurnMode(storyId, userId, newMode)` — `requireRole(['owner','gm'])`, `resolveTurnMode(newMode)` guard before writing, reads current `turn_config.active_mode` for `previous_mode`, jsonb-merges `active_mode` into `turn_config` (preserving other keys), inserts a `turn_mode_changes` row. Also added `listModeChanges(storyId, userId)` (any member, via `assertMember`) for reading the audit trail.
- [x] 4.2 Plain sequential service-role update+insert, no RPC — matches design.md's default (low-frequency, owner/GM-only, no concurrent invariant to protect), same shape as `canon-exceptions.ts`'s override writes.
- [x] 4.3 `apps/web/src/lib/engine/mode-switching.test.ts`: 8 tests — owner/GM switch succeeds; player rejected with nothing written; unregistered mode rejected with nothing written; previous/new mode chains correctly across two switches; unrelated `turn_config` keys preserved; `listModeChanges` returns most-recent-first and is readable by any member. 8/8 passing.

## 5. Extraction worker verification

- [x] 5.1 Read `apps/web/src/lib/engine/extraction-worker.ts` in full — it already reads `chapterResult.data.turn_mode` (the chapter's own stored mode, set at generation time) and resolves it via `resolveTurnMode(...).extractionTargets`, fed into `buildExtractorPrompt`. Already fully mode-generic; no code change needed.
- [x] 5.2 Added a describe block to `extraction-worker.test.ts` capturing each `callStructured` call's `userPrompt` and asserting an `action`-mode chapter and a `dialogue`-mode chapter produce distinct extractor prompts containing their respective `extractionTargets`. 7/7 passing (1 new).

## 6. Investigation mode clue-gating verification

- [x] 6.1 Covered in section 2's `turn-modes.test.ts` addition ("investigation mode instructs gating by tracked knowledge state, independent of any specific universe schema") — prompt-text assertion only, no schema-validation check added, per design.md Decision 5.

## 7. Docs (Docusaurus)

- [x] 7.1 `docs/docs/phases/phase-7-turn-modes.md`: new phase doc, following `phase-6-validation-gatekeeping.md`'s shape.
- [x] 7.2 `docs/docs/architecture/turn-modes.md`: new architecture doc — dispatch table pattern, Part 9 mode table, mode-switching semantics with an ASCII timeline, investigation mode's clue-gating approach. `turn-loop.md`'s stale "Phase 1 implements only freeform" note updated to link here.
- [x] 7.3 `docs/sidebars.ts`: added `phases/phase-7-turn-modes` and `architecture/turn-modes`.
- [x] 7.4 `docs/docs/phases/build-order.md`: Phase 7 row/section updated to implemented, linked.
- [x] 7.5 `docs/docs/reference/data-model.md`: `turn_config.active_mode` documented on `stories`; new `turn_mode_changes` section; "what exists by phase" gained a Phase 7 paragraph.
- [x] 7.6 `npm run build` inside `docs/` — clean, no broken links, no MDX issues.

## 8. Verification

- [x] 8.1 From `apps/web`: `npm test` (371/371), `npm run typecheck` (clean), `npm run build` (compiles, all routes generated) — all three pass.
- [x] 8.2 `supabase db advisors --linked` re-run after the migration — clean, only the two pre-existing accepted warnings. RLS coverage test re-run in section 1.3.
- [x] 8.3 `openspec validate phase-7-turn-modes --strict` passes.
- [x] 8.4 `apps/web/src/lib/engine/phase-7-exit-criterion.test.ts`: a story opens in `scene`, switches to `investigation`, opens again, switches to `action`, opens again — each turn keeps the mode active at its own creation, never retroactively changed; every switch recorded with correct previous/new chaining; a player cannot switch. 3/3 passing.

## Migrations this phase

- `<timestamp>_turn_mode_changes.sql` — new table, RLS per section 1

Apply to the linked Supabase project via `supabase db push --linked`; regenerate `database.types.ts` after.
