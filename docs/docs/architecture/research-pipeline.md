---
sidebar_position: 6
title: Research Pipeline
---

# Research Pipeline

:::info Implemented in Phase 3
See [Phase 3 — Research Pipeline](/phases/phase-3-research-pipeline).
:::

The research pipeline turns a universe name (plus optional source text, canon cutoff, and AU notes) into a draft Canon Bible: eight stages, each a `researcher`-role model call, each writing into a shared draft document that a human reviews before anything is published.

## The eight stages

See the [full stage table](/phases/build-order#the-eight-stages) for what each stage produces. Stages run in dependency order — each stage's prompt includes only the prior stages' output it actually needs, built by `stage-request.ts`:

```
Stage 1 Scoping
  ↓
Stage 2 Rules & Mechanics        (reads Stage 1)
Stage 3 Power/Progression        (reads Stage 1; conditional — see below)
  ↓
Stage 4 Canonical Entities       (reads Stages 1, 2)
  ↓
Stage 5 Timeline & Canon State   (reads Stage 4)
  ↓
Stage 6 Schema Derivation        (reads Stages 1, 3, 4)
  ↓
Stage 7 Rule Pack Generation     (reads Stages 1, 2, 3)
  ↓
Stage 8 Confidence & Gaps        (aggregates all of the above — not a model call)
```

## Stage 3 is conditional, not stubbed

Stage 3 (Power/Progression) runs only when Stage 1's own output reports `has_power_system: true`:

```ts
export function shouldRunProgressionStage(scoping: ScopingResult): boolean {
  return scoping.has_power_system.value;
}
```

When false, Stage 3's `research_jobs` row is set to `status: 'skipped'` with a null output — no model call happens, and Stage 6 reads the skipped status rather than expecting progression data. This reads a fact the research produced *for this specific draft*, never a hardcoded genre or universe name, so it does not violate the [no-genre-conditionals rule](/architecture/core-thesis) — the same reasoning [Phase 2](/phases/phase-2-universe-system) applies to a universe with `progression_model: 'none'`.

## Durable, resumable execution

The pipeline runs as one Inngest function with one `step.run` per stage. If the function's execution environment restarts after Stage 4 completes but before Stage 5 starts, resumption continues at Stage 5 — Stages 1 through 4 are neither re-executed nor re-billed, because Inngest memoizes a completed step across replay.

```ts
const scopingOutcome = await step.run('stage-scoping', () =>
  executeStage(draftId, 'scoping', input, draft, usage)
);
```

Every stage call goes through the same `callStructured` gateway every other AI call in this codebase uses: one retry on malformed output, then a typed error, a `usage_log` row on every attempt including failures.

## A failed stage does not abort the draft

`runStage` never throws past itself — a `StructuredOutputError` or transport failure becomes a typed `{ status: 'failed', error }` outcome. The orchestrator marks that stage's `research_jobs` row `failed` and moves on to the next stage using whatever upstream output is available. Stage 8 always runs last and explicitly lists every failed or skipped stage in its gaps report, so a failure is visible to the reviewing human rather than silently absent.

## Confidence and gaps

Every fact a stage produces wraps a value: `{ value, confidence: 'high'|'medium'|'low', source? }`. Stage 8 is not a model call — `buildGapsReport` walks the accumulated draft document generically (any object shaped like a fact wrapper, at any depth, in any section) collecting every `confidence: 'low'` fact, plus every stage marked `failed` or `skipped`:

```ts
export function buildGapsReport(draft: DraftDocument, jobs: readonly JobStatusInput[]): GapsResult
```

Because this walks generically rather than switching per section, a ninth stage's schema is covered automatically as long as it reuses the same `fact()` wrapper `schemas.ts` already defines for the other eight.

## Why Inngest, and why only here

Phase 1's `extraction_queue` — claim a row, process it, mark it complete, recover stale claims — is sufficient for one idempotent retryable call. It is not sufficient for eight sequential stages with real dependencies between them and a 5–15 minute total runtime a user is watching live. Modeling that in hand-rolled Postgres claiming means reimplementing a scheduler in SQL; Inngest's `step.run()` gives resumable, memoized steps for the cost of a function call.

This dependency is introduced *only* for the research pipeline. `extraction_queue` keeps its existing claim/update shape — there is no multi-step orchestration need there that would justify migrating it.
