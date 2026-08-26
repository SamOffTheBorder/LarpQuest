## 1. Migration

- [x] 1.1 Write migration adding `continues_chapter_id uuid references chapters(id) on delete set null` to `chapters`
- [x] 1.2 Write migration adding `continues_chapter_id uuid references chapters(id) on delete set null` to `turns`
- [x] 1.3 `supabase db push`, then `supabase db advisors --linked` and `supabase db query --linked --file supabase/tests/rls_coverage.sql` per CLAUDE.md's migration checklist (advisors: only pre-existing warnings unrelated to this migration; RLS coverage script fails on pre-existing `legal_acceptances`/`rate_limit_counters` — intentional service-role-only tables, not introduced by this change)
- [x] 1.4 Regenerate `apps/web/src/lib/supabase/database.types.ts`

## 2. Action mode turning-point marker

- [x] 2.1 Define the exact turning-point marker constant (e.g. `[TURNING_POINT]`) and a helper to detect + strip it when it is the last non-empty line of a prose string
- [x] 2.2 Add an eligibility helper (in `turn-modes.ts` or `turns.ts`) that counts distinct entities among a turn's submissions and returns whether the turn is eligible for the turning-point marker (exactly 2 distinct entities, and `continues_chapter_id` not set)
- [x] 2.3 Update `actionSystemPrompt` to accept an eligibility flag and only include turning-point marker instructions in the prompt when eligible
- [x] 2.4 Update `TurnModeStoryContext`/mode signature as needed to pass the eligibility flag through, following the existing `pacing`/`gatekeeperRulings` pattern of optional context fields
- [x] 2.5 Unit tests: eligible 1v1 turn's prompt includes the marker instructions; 1-entity, 3+-entity, and continuation turns' prompts omit them

## 3. Narration call and result handling

- [x] 3.1 Keep `generateTurn`'s `action`-mode call path on `streamNarration` unchanged (full streaming preserved); after the stream completes, run the marker-detection helper (2.1) over the final accumulated prose
- [x] 3.2 Enforce eligibility server-side: if the turn was ineligible (per 2.2) or already a continuation, strip/ignore the marker unconditionally and treat the turn as `turningPoint: false` regardless of what the model emitted
- [x] 3.3 Strip the marker from the prose before it is passed to validation and before it is persisted, so it never reaches the validator, readers, or the published chapter
- [x] 3.4 Unit tests: an ineligible turn's marker is stripped and coerced to a non-split outcome; an eligible turn's marker is detected and stripped from the persisted prose (covered by turn-modes.test.ts's `extractTurningPoint` suite; turns.ts integration covered in section 5)

## 4. Continuation turn creation (`continueFight`)

- [x] 4.1 Implement `continueFight(chapterId: string, storyId: string): Promise<void>` in `turns.ts`, called from `generateTurn` immediately after a chapter whose prose carried the turning-point marker publishes
- [x] 4.2 New `continue_fight_turn(p_chapter_id, p_story_id)` RPC (atomic, advisory-lock-guarded like `open_turn`): inserts the new `turns` row at `status: 'locked'`, `mode` copied from the originating chapter's `turn_mode`, `turn_number` = next in sequence, `continues_chapter_id` set to the originating chapter's id — bypassing `openTurn`'s role check since there is no acting user (migrations `20260826000004`/`...005`)
- [x] 4.3 `continue_fight_turn` copies the originating turn's submissions forward as new `submissions` rows on the new turn (same `entity_id`, `user_id`, `content`, `proposals`) in the same transaction, skipping `createSubmission`'s player-facing path and its moderation call entirely
- [x] 4.4 `continueFight` hands the new (already-`locked`) turn to the existing `generateTurn` unchanged — no separate code path was needed, since `continue_fight_turn` produces a turn in exactly the state `generateTurn` already knows how to claim and drive to `validating`/`published`/`failed`
- [x] 4.5 `publish_chapter` now copies `turn_row.continues_chapter_id` onto the new chapter row (migration `20260826000003`) — verified in section 5 integration test
- [x] 4.6 On failure, `continueFight`'s call site wraps it in an isolated try/catch (pattern: `queueChapterIllustration`'s catch in `image-prompts.ts`) that logs and swallows rather than throwing into the original `generateTurn` call's result; the new turn itself lands in `failed` via `generateTurn`'s own existing catch/`markTurnFailed`
- [x] 4.7 `turns_one_live_per_story` is respected: `continueFight` is only invoked after `publish_chapter` has already returned successfully (i.e. the originating turn is already `published`), and `continue_fight_turn`'s own advisory lock plus live-turn check double-guards it

## 5. Tests

- [x] 5.1 Integration test: a 1v1 `action` turn whose streamed prose ends with the turning-point marker publishes chapter 1 (marker stripped from persisted prose), then a continuation turn is created, generated, and published automatically with no additional submission
- [x] 5.2 Integration test: a continuation turn's own output marker (if the model emits one anyway) is always stripped and ignored, never triggering a second split
- [x] 5.3 Integration test: continuation turn generation failure (RPC not-found) leaves chapter 1 published and unchanged, and the failure is logged rather than propagated into the original call's result
- [x] 5.4 Integration test: copied-forward submissions land directly via the RPC, never through `createSubmission`'s player-facing/moderation path
- [x] 5.5 Regression test: group-fight (3+ entity) and single-entity `action` turns never split, regardless of what the model emits
- [x] 5.6 Full suite (`npm test`: 571 passed, `npm run typecheck`: clean, `npm run build`: succeeds) passes

## 6. Spec sync

- [ ] 6.1 Run `openspec archive fight-chapter-split` once implementation is verified, folding the new `fight-chapter-split` capability and the `turn-modes-extended`/`turn-loop` deltas into `openspec/specs/`
