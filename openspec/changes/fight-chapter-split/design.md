## Context

`generateTurn` (`apps/web/src/lib/engine/turns.ts`) currently does exactly one narration call per turn: assemble context, call the narrator with `mode.systemPrompt(...)`, validate, publish. `action` mode's structured output today is plain prose text (no Zod-parsed shape beyond the raw string from `streamNarration`).

Two DB constraints shape this design:
- `turns_one_live_per_story` (partial unique index) — at most one non-`published` turn per story at any time. A continuation turn cannot be created until the fight's first turn is `published`.
- `lockTurn` throws when a turn has zero submissions (`'cannot lock with no submissions'`), and runs submission moderation before allowing the lock. A system-initiated continuation turn has no new player submissions to moderate or lock against — it must not go through `openTurn`/`createSubmission`/`lockTurn` unmodified.

`turn-modes.ts`'s dispatch-table discipline (no conditional on genre/universe/media type) still applies. The turning-point signal must be a property of `action` mode's structured output, not a special case bolted onto `generateTurn` for "fights" as a concept the engine understands narratively — the engine only understands "the mode's structured output said this is partial."

## Goals / Non-Goals

**Goals:**
- `action` mode can signal "this is a turning point, not the fight's resolution" in its structured output, for a submission set of exactly two entities acting against each other.
- On that signal, `generateTurn` publishes the partial chapter normally, then triggers a second, fully automatic turn that resumes the same fight and always resolves it (no second split).
- Chapter 1's publication is never delayed, blocked, or reversed by anything to do with chapter 2 — same discipline as extraction currently gets.
- The continuation is invisible to players as a "submit something" moment: no new submission UI, no waiting on a player.

**Non-Goals:**
- Group fights (3+ entities) are not eligible for the turning-point signal at all — out of scope per the proposal, handled by existing single-chapter prompt structure.
- No configurable split threshold/setting.
- No change to `scene`/`investigation`/`dialogue`/`montage`/`freeform` modes.
- No change to how player-submitted turns are opened, submitted to, or locked — the new path is additive, not a modification of that flow.

## Decisions

### 1. Sentinel marker in streamed prose, not structured output

Narration (all modes, including `action`) runs through `streamNarration`, not `callStructured` — it is a genuinely different gateway function: a streaming, non-JSON call whose `onChunk` callback drives the live "chapter is being written" UI as tokens arrive. `callStructured` is JSON-mode only, non-streaming, and used today exclusively for extraction/validation/gatekeeper/summarization calls that have no live-reading UI to feed. There is no structured-output variant of narration in this codebase, and building one is out of scope — switching `action` mode's narration to `callStructured` would silently remove streaming from every `action` turn, not just eligible 1v1 fights, which is an unacceptable regression the original design missed.

Instead, `action` mode's prompt (only when eligible, per Decision 2) instructs the narrator to end its prose with an exact, distinct out-of-band marker line — `[TURNING_POINT]` on its own line, nothing after it — if and only if it is signaling a turning point rather than a resolution. `generateTurn` keeps calling `streamNarration` exactly as it does today, unchanged, preserving full live streaming. Once the stream completes, `generateTurn` checks the final accumulated prose for the marker at its end, strips it before the prose is validated/persisted (readers and the validator never see the marker), and sets a local `turningPoint: boolean` from whether it was present. This is a code-level string check, not user-facing structured output — CLAUDE.md #7's Zod-parsing rule governs *structured* AI outputs (extraction, validation, gatekeeper rulings, etc.); narration prose has never been schema-parsed in this codebase and this change does not newly obligate it to be, since the marker is a trivial, deterministic presence/absence check rather than a shape the model must get semantically right.

**Alternatives considered:**
- *Full Zod-structured narration output* (original design): correct in isolation but requires abandoning `streamNarration` for `action` mode, which regresses streaming UX for every action turn. Rejected.
- *A second, small `callStructured` follow-up call after the stream completes*, asking the model to judge turning-point-or-not from the prose it just wrote: preserves streaming and gets a schema-validated signal, but doubles narrator-adjacent model calls (cost + latency) on every eligible action turn just to extract one boolean. Rejected as disproportionate to what's being signaled — a marker the model itself decides to emit inline is simpler and the marker's presence/absence is unambiguous to check.
- *Unmarked sentinel appended after generation by a separate lightweight heuristic (e.g. regex over the prose for combat-ending language)*: rejected — this reintroduces exactly the kind of content-based, genre-flavored heuristic the "no conditionals on genre/universe/media type" rule exists to prevent. Asking the model itself to emit the marker keeps the judgment inside the narrator's own prompt-driven reasoning, not in engine code pattern-matching on fight vocabulary.

### 2. Eligibility gate lives in `generateTurn`, not in the prompt

Whether the turning-point marker is even offered as a possibility to the model is gated in code: `action` mode's system prompt only mentions the marker when `generateTurn` determines the turn's submissions resolve to exactly two distinct, opposing entities (i.e., a 1v1). Group fights never see the option in their prompt, so a group-fight model response cannot legally emit the marker — enforced by only including the marker instructions conditionally, and by `generateTurn` ignoring/stripping the marker from the final streamed prose whenever the eligibility check fails, treating it as a normal complete chapter regardless of what the model actually emitted.

This keeps the "engine knows nothing about combat" rule intact: `generateTurn` never asks "is this a fight" — it only counts distinct entities among the turn's submissions, which is genre-neutral. The word "fight" only ever appears in `action` mode's own prompt text, same as every other mode-specific instruction today.

**Alternative considered:** let the model decide eligibility itself from the prose. Rejected — puts a structural/engine decision (may this turn split?) in the hands of the model's narrative judgment, which the proposal's non-goals explicitly want kept deterministic (2-participant fights only).

### 3. Continuation is a new turn, created and driven entirely by `generateTurn`'s own code path

A new function, `continueFight(turnId: string)`, called from inside `generateTurn` immediately after chapter 1 successfully publishes when `turningPoint === true`:
1. Insert a new `turns` row directly (service-role, bypassing `openTurn`'s owner/gm check — there is no acting user) with `status: 'generating'` from the start, `mode: 'action'`, and a new `continues_chapter_id` column pointing at chapter 1's id.
2. Copy chapter 1's originating submissions forward as new `submissions` rows tied to the new turn (not moved — the originals stay attached to chapter 1's turn, per "submissions persist independently of generation" and so chapter 1's history stays intact if it's ever inspected). Copies preserve `user_id`, `entity_id`, `content`, `proposals` verbatim; no new moderation pass, since the content is not new — it was already moderated when chapter 1 locked.
3. Run the same narration → validate → publish path `generateTurn` already runs, with context assembly including chapter 1's prose/summary as the most recent chapter (already true — `buildTurnContext` pulls recent chapters) so the continuation reads as a direct resumption.
4. This second call is forced non-splittable: `action` mode's prompt for a continuation turn omits the turning-point option entirely (gate #2 also covers "already continued once").

This reuses `open → locked → generating → validating → published/failed` unchanged — the continuation turn is a normal turn from the state machine's point of view, just created without a human calling `openTurn`. `turns_one_live_per_story` is satisfied because the new row is only inserted after chapter 1's turn already transitioned to `published`.

**Alternative considered:** extend the *same* turn/chapter with a second narration pass instead of creating a new turn+chapter. Rejected — the proposal explicitly wants two chapters (the cliffhanger publish is the point), and reusing one turn row across two chapters would break `chapters.turn_id`'s one-to-one shape relied on elsewhere (e.g. rollback, `entity_history.chapter_id`).

### 4. Failure isolation

If `continueFight` throws (narration error, validator exhaustion, DB error), the new turn lands in `failed` exactly like any other failed turn — retryable via the existing retry path (an owner/gm can call the existing retry entry point manually, same as any other failed turn). Chapter 1 is already committed and published before `continueFight` is ever invoked, so its status is unaffected by any downstream failure. `generateTurn`'s own return value/thrown error for the *original* call reflects only chapter 1's outcome; continuation failures are logged (same pattern as `queueChapterIllustration`'s isolated catch) and never bubble into the original call's result.

### 5. New column: `chapters.continues_chapter_id` and `turns.continues_chapter_id`

- `chapters.continues_chapter_id uuid references chapters(id) on delete set null` — nullable, set on chapter 2 pointing at chapter 1. Lets the UI/context assembly/export treat the pair as one continuous scene without inferring it from turn_number adjacency.
- `turns.continues_chapter_id uuid references chapters(id) on delete set null` — same value, set at turn-creation time, so `generateTurn` knows (without a chapter yet existing) that this turn is a continuation and should suppress the turning-point option in the prompt (Decision 2/4).

RLS: both columns live on existing tables (`chapters`, `turns`) whose policies already gate through `is_story_member`/`is_story_owner`. No new policy needed — same rule as every other column added to these tables.

## Risks / Trade-offs

- **[Risk] A continuation turn could itself want to split again if the model ignores the suppressed prompt option.** → Mitigation: `generateTurn` strips and ignores the turning-point marker from the streamed prose whenever `turns.continues_chapter_id` is already set, regardless of what the model actually emitted (Decision 2's enforcement is in code, not just prompt wording).
- **[Risk] The model emits the marker inexactly (extra whitespace, wrong casing, embedded mid-sentence instead of on its own trailing line) and the check misses it, or a player's submitted content coincidentally contains the marker text.** → Mitigation: the check only looks for the exact marker as the last non-empty line of the stream, case-sensitive; player-submitted content is untrusted input rendered inside fenced sections in the *prompt*, never in the model's *output*, so a player cannot inject the marker into what gets checked. A near-miss simply fails to signal a turning point — the chapter publishes as a normal complete chapter, which is a safe fallback, not a crash.
- **[Risk] Copying submissions forward duplicates rows, and a rollback of chapter 1 (GM unpublish) leaves chapter 2 referencing state that assumed chapter 1 happened.** → Mitigation: unpublishing chapter 1 is already a manual, deliberate GM action; out of scope to auto-cascade to chapter 2 in this change. Document as a known limitation — a GM who unpublishes chapter 1 of a split fight should also handle chapter 2 manually. Flag for a future change if it proves painful in practice.
- **[Risk] `continueFight` running fully server-side/automatically means no player sees streaming output for chapter 2 the way they do for a normal turn (`onChunk` has no live subscriber).** → Mitigation: out of scope for this change; chapter 2 simply appears once generation completes, same as how extraction/illustration already complete invisibly in the background. A future change could wire Realtime so subscribers see chapter 2's streaming the same way — not required for this proposal's goal (the cliffhanger + automatic resolution).
- **[Trade-off] Eligibility is "exactly 2 distinct entities among this turn's submissions," which is a structural proxy for "1v1 fight," not a semantic one.** A turn where two entities each submit unrelated actions (not fighting each other) is technically eligible and could get offered the turning-point option. Accepted: `action` mode's prompt already only offers the option when the model's own read of the submissions is an adversarial 1v1, so a non-fight 2-entity turn simply never sees the model choose `turningPoint: true` in practice — the prompt makes the narrative judgment, the code only makes the structural (count) judgment.

## Migration Plan

1. New migration: add `continues_chapter_id` to `chapters` and `turns` (nullable FK, `on delete set null`), no RLS changes needed.
2. Run `supabase db push`, then `supabase db advisors --linked` per CLAUDE.md's migration checklist.
3. Ship `action` mode's schema/prompt change and `continueFight` together — the column must exist before `continueFight` can write it, but the column alone is inert (nullable, unused by any other code) so migration can land first with zero behavior change, then the code change in a follow-up deploy if desired.
4. No data backfill — existing chapters/turns simply have `continues_chapter_id = null`, meaning "not a continuation," which is the correct default.
5. Rollback: drop the column (safe — nothing else references it) if the feature is reverted; no destructive action needed on existing rows either way.

## Open Questions

- Should chapter 2's illustrator/image-prompt pass treat the pair specially (e.g. always illustrate chapter 2's resolution moment), or is the existing per-chapter image-prompt flow sufficient unchanged? Leaning toward unchanged — out of scope unless the user asks.
- Should there be a hard cap on how much prompt-provided fight context (chapter 1's prose) is carried into chapter 2's context assembly, distinct from the normal recent-chapters window? Leaning toward: no special case, rely on `buildTurnContext`'s existing recent-chapters logic, since chapter 1 will already be the most recent chapter by the time chapter 2 generates.
