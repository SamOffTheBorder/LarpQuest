## Why

Right now a `action`-mode turn resolves an entire fight — however long, however many exchanges — in one chapter, one narration call. For a 1v1 fight the user wants the payoff of a cliffhanger: chapter 1 escalates to a turning point and publishes, chapter 2 resolves it, with no player having to submit a second turn to make that happen. All eight build-plan phases are complete and archived; this is a post-Phase-8 extension of the existing `turn-modes-extended` and `turn-loop` capabilities, not new-phase work.

## Non-goals

- Group/multi-character fights are explicitly out of scope for splitting. They stay a single chapter with internal narrative sections (spotlight per combatant, then a combined finish) — a prompt-only change already shipped in `action` mode's system prompt. This proposal must not touch that.
- No change to turn modes other than `action`. `scene`, `investigation`, `dialogue`, `montage`, `freeform` are unaffected.
- No new player-facing UI for configuring the split (no "split threshold" setting). The narrator's own judgment of a turning point drives it.
- No change to how submissions are collected, validated, or persisted — this only affects what happens after a turn's narration is generated.

## What Changes

- The narrator, when running `action` mode against a submission that resolves into a 1v1 fight, may signal that the fight has reached a natural turning point rather than a resolution, producing a partial chapter plus a continuation signal instead of a complete one.
- On a partial result, `generateTurn` publishes the partial prose as a normal chapter (same validation/gatekeeper path, same `entity_history` writes for whatever state actually changed) and then automatically starts a second, GM/player-invisible continuation turn that resumes the same fight from where it left off — no new submission required.
- The continuation turn reuses the original submissions (the fight's intent is unchanged; only the narration continues) and carries forward enough of chapter 1's content for chapter 2 to read as a direct continuation, not a new scene.
- Chapter 2 always resolves the fight — the engine does not allow a second split. A fight is at most two chapters.
- If the continuation turn fails, it fails exactly like any other turn: it lands in `failed`, is retryable, and chapter 1 — already published — is untouched. Splitting a fight must never put chapter 1's publication at risk.

## Capabilities

### New Capabilities

- `fight-chapter-split`: covers the narrator's turning-point signal for 1v1 `action` fights, the auto-continuation mechanism that generates and publishes chapter 2 without a new player submission, and the invariants that bound it to exactly one split and never block or reverse chapter 1's publication.

### Modified Capabilities

- `turn-modes-extended`: `action` mode's structured output gains an optional "this is a turning point, not a resolution" signal, scoped to 1v1 fights only.
- `turn-loop`: the loop gains a system-initiated continuation path (turn completes as partial → a new turn opens, locks, and generates automatically) that exists alongside the player-submission-initiated path already specified there. The existing `open → locked → generating → validating → published/failed` state machine is reused as-is per turn; no new turn status is introduced.

## Impact

- `apps/web/src/lib/engine/turn-modes.ts` — `action` mode's structured output schema and prompt gain the turning-point signal, gated to submissions the mode/context identifies as a 1v1 fight.
- `apps/web/src/lib/engine/turns.ts` — `generateTurn` handles a partial result: publish chapter 1, then open+lock+generate a continuation turn automatically instead of returning to `open` for the next player submission.
- `apps/web/src/lib/engine/turn-state.ts` — reused unchanged; continuation turns pass through the same transitions as any other turn.
- New DB consideration: chapter 2 needs a way to know it is a continuation of chapter 1's same fight (e.g. a `continues_chapter_id` reference or a `turns` flag) so context assembly includes chapter 1's ending state and the extractor/memory pipeline treats the pair coherently. Exact shape is a design.md decision.
- No RLS surface changes expected beyond whatever new column(s) land in `chapters`/`turns` — same table, same policies, per the migration-authoring rule in CLAUDE.md.
