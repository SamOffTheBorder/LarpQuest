---
sidebar_position: 4
title: Phase 3 — Research Pipeline
---

# Phase 3 — Research Pipeline

**Status:** Implemented
**Spec location:** `openspec/changes/phase-3-research-pipeline/`

Phase 3 is the flagship feature described in build plan Part 2: a user types a universe name and the system produces a reviewable Canon Bible, Entity Schema, Rule Pack, and seed entities automatically, instead of the universe being hand-authored the way [Ashfall Legion and Wovenmere](/phases/phase-2-universe-system) were. This is the phase that makes "research before writing" ([Part 0.3](/architecture/core-thesis)) real rather than aspirational.

**Exit criteria:** Typing "Jujutsu Kaisen" produces a usable, reviewable universe bible in under 15 minutes.

## What ships

- **The eight-stage research pipeline** ([full stage table](/phases/build-order#the-eight-stages)) — Scoping, Rules & Mechanics, Power/Progression, Canonical Entities, Timeline & Canon State, Schema Derivation, Rule Pack Generation, Confidence & Gaps — each a `researcher`-role model call, Zod-validated, writing into a shared draft document
- **Durable orchestration via Inngest** — introduced in this phase specifically (see [below](#why-inngest-arrives-here)); one function, one `step.run` per stage, resumable after a crash without re-running or re-billing completed stages
- **Conditional Stage 3** — Power/Progression runs only when Stage 1's own output for that draft reports `has_power_system: true`; otherwise it's recorded `skipped`, not stubbed
- **Live progress** — Supabase Realtime on `research_jobs`, no polling
- **Human review UI** — accept/edit/reject per section, confidence + source shown per fact, freeform house rules, "mark as AU" per fact, a diff view after re-running a stage
- **Publish path** — an accepted draft maps to the existing Phase 2 `UniverseVersionInput` and calls `createUniverse` unchanged; this phase produces the input, it does not touch versioning

## What does not ship

Source ingestion beyond plain pasted text (PDF parsing, wiki crawling) · any Validator/Gatekeeper wiring against the generated rule pack (Phase 6) · multiplayer draft review — a draft is single-owner · new progression-model *behavior* — Stage 6 only picks a slug from the [Phase 2 registry](/architecture/schema-system#progression-models), it never invents dispatch logic.

## Capabilities specified

| Capability | Covers |
|---|---|
| `research-pipeline` | The eight-stage job, per-stage retry, conditional Stage 3, durable resumable execution, confidence/gaps aggregation |
| `universe-review` | Accept/edit/reject, house rules, AU marking, re-run diffing, publishing a draft to a universe version |

## Key design decisions

### Why Inngest arrives here

Phase 1's `extraction_queue` (claim/update a Postgres row, `skip locked`, stale-claim recovery) works for one idempotent retryable call. The research pipeline is eight *sequential* stages — stages 2 through 8 read prior stages' output, Stage 3 is conditionally skipped, total wall time runs 5–15 minutes with progress the user watches live. Modeling that in hand-rolled Postgres claiming means reimplementing a scheduler in SQL. Inngest's `step.run()` gives per-step retry and memoization for free: a replayed function skips re-executing (and re-billing) any step that already completed.

*Not migrated:* Phase 1's extraction queue keeps its own claim/update pattern. It is not moved onto Inngest — it has no multi-step orchestration need that would justify the change.

### `research_jobs` rows are observability, not retry truth

Each stage writes its own `research_jobs` row from inside its `step.run`, so the status transition happens exactly once, at the moment the stage actually executes. Inngest's own step checkpointing — not a claim column — is what makes a crash-and-resume safe; the database row exists so the review UI has something to subscribe to.

### Stage 3's skip is data, not a genre conditional

`shouldRunProgressionStage(scoping)` reads `scoping.has_power_system.value` — a boolean *that draft's own Stage 1 research produced* — never a hardcoded universe name or genre tag. This is the same "absence is data" shape [Phase 2](/phases/phase-2-universe-system) uses for a null `progression_model`: the skip is a fact about this specific universe, evaluated identically regardless of what the universe turns out to be.

### Drafts are owned by a user, not a story — the one documented RLS exception

Every other table in this schema is gated through `story_members`. `universe_drafts` and `research_jobs` are gated through `owner_id = auth.uid()` instead, because a draft exists *before* any story or published universe does — there is no `story_members` row to check against yet. The migration comment states this explicitly so it isn't copied as a pattern elsewhere by mistake.

### Re-run reuses the pipeline's own prompt construction

`stage-request.ts` builds the `(systemPrompt, userPrompt, schema)` triple for a given stage from whatever upstream sections are in the draft document — shared by both the full pipeline (`run-research-pipeline.ts`) and a single-stage re-run (`rerun-research-stage.ts`). A re-run asks the *same question* the original run asked (edits included — an edited upstream section's `editedContent` is preferred over `content`), which is what makes "diff previous output vs. new output" a meaningful comparison rather than a diff between two different questions.

### AU marks are a side-record, not a mutation

Marking a fact as an AU divergence never touches the fact itself. `draft.auMarks` is a flat array of `{ section, path, divergenceNote }` records; the original researched value stays exactly as researched. A `markedAu` flag living inside the fact wrapper couldn't make that guarantee without a mutation.

## Database objects

Created in Phase 3: `universe_drafts` (input, accumulating draft document, status, eventual `universe_id`/`published_version`), `research_jobs` (one row per stage per draft, status/output/previous_output/attempt_count). New RPC: `start_research_job` (atomic status-to-running + attempt-count increment, mirroring `claim_extraction_job`'s shape). No existing table changes.

→ [Full data model](/reference/data-model)

## Verifying the phase

- `pipeline.test.ts` — a malformed stage response never throws past `runStage`, it becomes a typed failure the orchestrator can continue past; Stage 3's skip decision reads the draft's own scoping output
- `gaps.test.ts` — low-confidence facts collected across sections including nested arrays; failed/skipped stages explicitly listed
- `drafts.test.ts` — draft creation seeds all eight job rows; a non-owner read is rejected with the same error a nonexistent draft would produce; re-run preserves `previous_output`
- `review.test.ts` — accept/edit/reject only ever change a section's status (and, for edit, its content); a house rule is appended with `source: 'user'`; an AU mark leaves the original fact byte-for-byte unchanged
- `publish.test.ts` — an accepted draft produces a real `UniverseVersion` via the (mocked) `createUniverse`; publish is blocked with a named section when Schema Derivation isn't accepted; the draft row survives publish
- `npm test`, `npm run typecheck`, `npm run build` all pass from `apps/web`

### Local development

Inngest's Dev Server runs alongside `next dev` with no Docker and no keys:

```bash
npm run dev            # Next.js
npm run dev:inngest    # Inngest Dev Server (npx inngest-cli@latest dev)
```

Production requires `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` (Inngest Cloud); both are optional in local dev, where the SDK auto-discovers the Dev Server.

## Working the phase

```bash
openspec show phase-3-research-pipeline
openspec status --change phase-3-research-pipeline
openspec validate phase-3-research-pipeline
```

→ [Spec workflow](/reference/spec-workflow)
