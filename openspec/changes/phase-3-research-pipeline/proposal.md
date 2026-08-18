## Why

Phase 2 gave universes a schema and a progression model, but every universe today is still hand-authored (see `test-universes.ts`). Build Plan Part 10 assigns Phase 3 to the flagship feature described in Part 2: typing a universe name and getting back a reviewable Canon Bible, Entity Schema, Rule Pack, and seed Entities in minutes instead of hand-writing them. Without this, StoryForge cannot onboard a new universe faster than a human authoring one by hand, which defeats the product's core thesis (Part 0.3 — "research before writing").

## What Changes

- New `universe_drafts` table: one row per research run, holding `status`, `input` (name, source materials, canon cutoff, AU notes), and the accumulating draft document (per-stage JSON sections), scoped to the creating user via RLS.
- New `research_jobs` table: one row per Part 2.2 stage (8 rows per draft), each independently retryable, carrying `stage`, `status`, `attempt_count`, `claimed_at` (stale-claim recovery, mirroring `extraction_queue`), `output`, `last_error`. This is the phase where a durable-job orchestrator is introduced (Part 10/Phase 1 note): stages 2–8 depend on earlier stages' output, which the Phase 1 single-retry queue pattern does not model, so stage transitions run through Inngest step functions that claim/update these rows rather than reimplementing orchestration in Postgres.
- `apps/web/src/lib/research/pipeline.ts`: the 8-stage pipeline (scoping, rules & mechanics, power/progression, canonical entities, timeline & canon state, schema derivation, rule pack generation, confidence & gaps), each stage a Zod-validated `researcher`-role model call, each writing its section into the shared draft and its own `research_jobs` row on success or failure. Stage 3 (power/progression) is skipped — not stubbed with a conditional — when Stage 1's `has_power_system` is false, via the same "absence is data" pattern Phase 2 uses for an unset progression model.
- `apps/web/src/lib/research/gaps.ts`: Stage 8 aggregates every prior stage's low-confidence/unverified fields into a single gaps report attached to the draft.
- Progress streaming: an Inngest-driven status column plus a realtime subscription (existing Supabase Realtime, already used nowhere else yet in this repo, first use here) so the review UI shows live per-stage progress without polling.
- Human review UI (`apps/web/src/app/universes/new/...` and `apps/web/src/app/universes/[draftId]/review/...`): section-by-section accept/edit/reject, confidence badge + source citation per researched fact, freeform house-rule entry, per-fact "mark as AU" (recorded, not deleted — validators must respect it downstream), and a diff view when a stage is re-run.
- Publish action: converts an accepted draft into a Phase-2 universe version by calling the existing `createUniverse`/`publishUniverseVersion` engine functions unchanged — this proposal does not modify universe versioning, only produces its input.
- Every research model call writes a `usage_log` row (including failed-after-billed calls), per the project-wide model-call contract.

## Capabilities

### New Capabilities
- `research-pipeline`: the 8-stage async research job, its job/draft persistence, retry and stale-claim recovery, and the draft-document assembly that stages write into.
- `universe-review`: the human review workflow over a draft — accept/edit/reject per section, confidence/source display, house rules, AU marking, re-run diffing, and publishing a draft to a Phase 2 universe version.

### Modified Capabilities
(none — universe versioning, entity schema, and progression models from Phase 2 are consumed as-is via `universes.ts`; no requirement in `entity-state` or an existing spec changes)

## Impact

- New tables: `universe_drafts`, `research_jobs` (migration + RLS gated through story-independent user ownership, since a draft precedes any story).
- New dependency: Inngest (or Trigger.dev) added to `apps/web`, introduced for the first time per the Phase 1 deferral note.
- New model role usage: `researcher` (already defined in `apps/web/src/lib/ai/roles.ts`, unused since Phase 1).
- New UI routes under `apps/web/src/app/universes/`.
- Docusaurus: new `docs/docs/phases/phase-3-research-pipeline.md`, new `docs/docs/architecture/research-pipeline.md`, updates to `docs/docs/phases/build-order.md` and `docs/docs/reference/data-model.md`.
- No changes to `turns.ts`, `chapters.ts`, `extraction-worker.ts`, or any Phase 1/2 engine file — the research pipeline is additive and upstream of story creation.
