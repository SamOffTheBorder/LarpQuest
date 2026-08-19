---
sidebar_position: 3
title: The Turn Loop
---

# The Turn Loop

Every turn mode, every genre, every universe uses this identical loop. There are no genre-specific variants.

```
 1. OPEN      GM (or system) opens turn, optionally sets scene
 2. SUBMIT    Players submit actions; lock on deadline or when all in
 3. ASSEMBLE  Build Context Pool from Canon + Schema + Entities + Narrative
 4. GENERATE  Narration model writes the chapter
 5. VALIDATE  Validator model checks against Canon + Schema + entity state
 6. GATE      Blocking violations → regenerate (max 2 retries) or escalate to GM
 7. PUBLISH   Chapter written to Narrative layer
 8. EXTRACT   State extraction produces JSON diffs
 9. APPLY     Diffs auto-apply or queue for GM approval (configurable)
10. INDEX     Summary + embedding generated and stored
11. NEXT      New turn opens
```

:::warning Do not skip steps 3, 5, and 8
These are what make long stories work. They are also the three that look skippable when you want to ship faster. Assembly, validation, and extraction are the loop.
:::

## The steps that matter most

### 3. Assemble

Builds the prompt from structured state rather than conversation history. This is the step that makes chapter 100 as coherent as chapter 5. See [Context Assembly](/architecture/context-assembly).

### 5. Validate

A separate, cheap, fast model audits the chapter against canon rules and entity state. It is **not** the narrator checking its own work. See [Validation & Gatekeeping](/architecture/validation-gatekeeping).

### 8. Extract

Converts the prose back into structured diffs — the return half of the state/prose cycle. Without it, state stops tracking the story and the whole thesis collapses.

## Publication is never blocked by extraction

Step 7 commits before step 8 runs. If extraction fails or returns garbage, **the chapter stays published** and extraction is queued for retry.

The reasoning: a reader waiting on a flaky structured-output call is a worse failure than state being briefly stale. State can catch up; a blocked story cannot.

## Turn state machine

```
open ──► locked ──► generating ──► published
                         │
                         ▼
                      failed ──► (retry) ──► generating
```

Transitions are enforced centrally, so an invalid one such as `published → generating` cannot happen from a stray call site.

## Failure handling

Generation is the most expensive and most fragile step. The loop is designed around it failing:

- **Submissions persist independently of generation.** A failed generation never destroys player input. A `failed` turn is retryable and reuses the original submissions verbatim.
- **Streaming with partial save.** A timeout after 4k tokens leaves recoverable text, not nothing. At 4–8k tokens per chapter, discarding partial output is real money.
- **Validation retries are capped at 2**, then escalate to a human rather than looping.
- **Extraction failure never blocks publication.**
- **Rollback works.** Unpublishing a chapter reverses its applied diffs via `entity_history`, writing compensating rows rather than deleting originals.

## Turn modes

The same loop, with a different prompt template and extraction targets. Modes are resolved through a dispatch table — never a conditional on genre.

| Mode | Player submits | Narrator produces | Extractor targets |
|---|---|---|---|
| `action` | Intended action | Resolution with consequences | Capabilities, injuries, resources, deaths |
| `scene` | Intent/emotional goal | A scene, unresolved | Relationships, emotional state, revelations |
| `investigation` | Line of inquiry | Information gated by clue graph | Knowledge state, evidence, suspicion |
| `dialogue` | What they say/attempt | Conversation turn | What was revealed, standing shifts |
| `montage` | Focus area | Time skip, development summary | Progression across a span |
| `freeform` | Anything | Anything | Generic diff |

Modes are switchable mid-story. A story might run `scene` for setup, `investigation` through the middle, and `action` for the climax.

**Phase 1 implemented only `freeform`.** Phase 7 registered the other five in the same dispatch table — adding them required zero changes to the loop itself, exactly as designed. See [Turn Modes](/architecture/turn-modes) for how switching works and how each mode's prompt/extraction pair is built.

## What's actually built vs. planned, as of Phase 1

The steps above describe the design. Phase 1's real implementation collapses steps 5–6 (validate/gate) — there is no validator role call yet; a chapter publishes once narration produces non-empty, fully-streamed prose. Validation and gatekeeping arrive in a later phase (see [Validation & Gatekeeping](/architecture/validation-gatekeeping)). Everything else below reflects what actually runs today, not the target design.

**Open → submit → lock** (`src/lib/engine/turns.ts`): `openTurn` is guarded by a Postgres advisory lock plus a partial unique index (`turns_one_live_per_story`) so two concurrent opens can't both succeed — the database enforces the one-live-turn invariant, not application code. `lockTurn` refuses a turn with zero submissions.

**Generate** is a two-part flow, not one function call:

1. A route handler, `stories/[storyId]/turns/[turnId]/generate/route.ts`, opens a Server-Sent Events stream. It locks the turn (or, on retry, skips straight to generation), then calls `generateTurn`/`retryTurn`.
2. `generateTurn` assembles context, calls `streamNarration`, and forwards each accumulated chunk back through the SSE stream as it arrives — so the browser shows prose live rather than a static "writing…" message. On success it calls the `publish_chapter` database function, which writes the chapter, advances the turn to `published`, bumps the story's `current_turn`, and enqueues extraction — all as one transaction.

The route handler's request stays open for the full duration of generation. This is deliberate: a Server Action or route handler isn't guaranteed to keep running after its response is sent, so generation is always fully awaited within the request lifecycle. An interrupted `generating` turn would have no path back to `failed` (retry only accepts `failed`), so nothing here is fired-and-forgotten.

**Extract** (`src/lib/engine/extraction-worker.ts`) is a pull-based worker, not a background process the app starts itself. `publish_chapter` only inserts a row into `extraction_queue` — nothing calls the extractor synchronously. A separate route, `POST /api/worker/extract` (bearer-token authenticated via `WORKER_SECRET`), claims one queued job via `claim_extraction_job` (which also recovers stale claims — a crashed worker's abandoned row becomes claimable again after a timeout) and applies its diffs. **Nothing currently calls this route on a schedule** — it needs a cron trigger (Vercel Cron, a Supabase scheduled function, etc.) wired up as a deploy-time decision, or it can be called manually. Until that's wired up, chapters accumulate at `extraction_status: pending` until someone calls the route.

**Rollback** (`rollback_chapter` database function, migration `20260813000004`) reverses a chapter's `entity_history` rows in reverse chronological order, as new compensating rows — never by deleting or editing the originals. The chapter itself stays visible in the reader, marked with a "Rolled back" badge rather than removed; only its entity effects are undone. If a field the chapter set has since been changed by a later chapter or a manual edit, that field is left alone and reported as a conflict rather than overwritten — verified against real tables in `supabase/tests/rollback_conflict.sql`.
