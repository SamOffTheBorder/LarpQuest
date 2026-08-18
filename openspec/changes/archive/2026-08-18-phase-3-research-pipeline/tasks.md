## 1. Database: drafts and per-stage jobs

- [x] 1.1 `supabase/migrations/<ts>_universe_drafts.sql`: `universe_drafts` table — `id`, `owner_id references auth.users`, `status text check (status in ('researching','ready_for_review','published'))`, `input jsonb` (name, source_text, canon_cutoff, au_notes), `draft jsonb` (accumulating section document), `universe_id`, `published_version int`, `created_at`, `updated_at`. RLS: owner-only select/insert/update, explicitly commented as the documented exception to the `story_members` gate (design.md decision 1) since no story exists yet.
- [x] 1.2 Same migration: `research_jobs` table — `id`, `draft_id references universe_drafts on delete cascade`, `stage text check (stage in ('scoping','rules_mechanics','progression','entities','timeline','schema_derivation','rule_pack','gaps'))`, `status text check (status in ('queued','running','complete','failed','skipped'))`, `attempt_count int default 0`, `output jsonb`, `previous_output jsonb`, `last_error text`, `created_at`, `updated_at`, `unique (draft_id, stage)`. RLS: readable only via the parent draft's `owner_id`.
- [x] 1.3 Same migration: `touch_updated_at` triggers on both tables reusing the Phase 1 trigger function; enable Realtime replication on `research_jobs` (`alter publication supabase_realtime add table research_jobs`) for progress streaming.
- [x] 1.4 `supabase db push` against the linked project, then `supabase db advisors --linked` and `supabase db query --linked --file supabase/tests/rls_coverage.sql` to confirm no RLS/search_path gaps.

## 2. Inngest wiring

- [x] 2.1 Add `inngest` to `apps/web/package.json`. (`inngest-cli` is invoked via `npx inngest-cli@latest dev` / `npm run dev:inngest` rather than pinned as a devDependency — its postinstall binary-download step failed at the last patched version and it's dev-tooling only, never imported by app code, so `npx` on demand has the same effect without a stale/vulnerable copy sitting in `node_modules`.)
- [x] 2.2 `apps/web/src/inngest/client.ts`: the `Inngest` client instance, app id `storyforge`.
- [x] 2.3 `apps/web/src/app/api/inngest/route.ts`: Next.js route handler serving the client via `inngest/next`'s `serve()`, registering the research-pipeline function from task 3.7.
- [x] 2.4 Document local dev in `docs/docs/phases/phase-3-research-pipeline.md` (task 9.1): `npm run dev:inngest` alongside `npm run dev`, no Docker required.

## 3. Research pipeline stages

- [x] 3.1 `apps/web/src/lib/research/schemas.ts`: Zod schemas for each stage's output — `scopingResultSchema` (media_type, genre_tags, has_power_system, power_system_type, scale_ceiling, primary_conflict_mode, tone, recommended_turn_modes), `ruleSchema`/`rulesResultSchema` (rule text, citation/confidence per Part 2.2 Stage 2), `progressionResultSchema` (Part 2.2 Stage 3 fields), `entitiesResultSchema` (Part 2.2 Stage 4), `timelineResultSchema` (Part 2.2 Stage 5), `schemaDerivationResultSchema` (an `entity_schema` per Phase 2's `entitySchemaSchema` plus a chosen `progression_model` slug and `progression_config`), `rulePackResultSchema` (Part 5.1/5.2 shaped validation rules with `source`/`severity`), `gapsResultSchema`. Every fact-bearing field wraps `{ value, confidence: 'high'|'medium'|'low', source: z.string().optional() }` (universe-review spec's confidence/source requirement).
- [x] 3.2 `apps/web/src/lib/research/draft.ts`: `draftDocumentSchema` composing the eight sections (each optional until its stage completes) plus per-section `status: 'pending'|'accepted'|'edited'|'rejected'`; `applyStageOutput(draft, stage, output)` pure function merging one stage's result into the accumulating document.
- [x] 3.3 `apps/web/src/lib/research/prompts.ts`: system + user prompt builders for each of the 8 stages, each explicitly citing which prior sections are included as context (Stage 2 gets Stage 1; Stage 6 gets Stages 1–5; etc.), matching Part 2.2's stage descriptions.
- [x] 3.4 `apps/web/src/lib/research/pipeline.ts`: `runStage(stage, draftId, input, priorSections)` — calls `callStructured` with `role: 'researcher'`, the stage's prompt and schema, an injected `UsageRecorder`; on success writes `research_jobs.status = 'complete'`, `output`; on `StructuredOutputError` writes `status = 'failed'`, `last_error`, and returns a typed failure rather than throwing, so the orchestrator can continue to the next stage.
- [x] 3.5 Same file: `shouldRunProgressionStage(scopingOutput): boolean` reading `has_power_system` off Stage 1's own output for this draft (design.md decision 4) — used by the orchestrator to write `status: 'skipped'` instead of invoking Stage 3.
- [x] 3.6 `apps/web/src/lib/research/gaps.ts`: `buildGapsReport(draft, jobs)` — Stage 8, aggregates every `confidence: 'low'` fact across sections plus any `failed`/`skipped` `research_jobs` rows into a single report structure matching `gapsResultSchema`.
- [x] 3.7 `apps/web/src/inngest/functions/run-research-pipeline.ts`: the Inngest function, one `step.run` per stage (skipping/short-circuiting Stage 3 per 3.5), calling `runStage`/`buildGapsReport`, updating `universe_drafts.draft` and `.status` after each step. Triggered by an `research/draft.requested` event.
- [x] 3.8 `apps/web/src/lib/research/pipeline.test.ts`: unit tests — stage output merges into draft correctly; malformed stage output (mocked gateway) results in `failed` status and pipeline continues; Stage 3 skipped when `has_power_system: false` and executed when `true`; every stage call records `usage_log` via the injected recorder including on failure.
- [x] 3.9 `apps/web/src/lib/research/gaps.test.ts`: gaps report includes low-confidence facts from multiple sections and explicitly lists a failed/skipped stage.

## 4. Draft persistence layer

- [x] 4.1 `apps/web/src/lib/research/drafts.ts`: `createDraft(ownerId, input)` (inserts `universe_drafts`, seeds 8 `research_jobs` rows as `queued`, sends the Inngest trigger event), `getDraft(draftId, ownerId)`, `listDraftJobs(draftId, ownerId)` — all ownership-checked against `owner_id`, mirroring `universes.ts`'s membership-check-first pattern.
- [x] 4.2 Same file: `rerunStage(draftId, ownerId, stage)` — moves current `output` to `previous_output`, resets that stage's `research_jobs` row to `queued`, re-sends the Inngest trigger scoped to that single stage. (Required adding a second Inngest function, `rerun-research-stage.ts`, and extracting per-stage prompt/schema construction into `stage-request.ts` so the full pipeline and a single-stage re-run build an identical request — this went beyond the task's original file list but was necessary for the re-run event to actually be handled.)
- [x] 4.3 `apps/web/src/lib/research/drafts.test.ts`: create draft seeds correct job rows; a non-owner read is rejected; re-run preserves `previous_output` and resets status.

## 5. Review actions

- [x] 5.1 `apps/web/src/lib/research/review.ts`: `acceptSection`, `editSection`, `rejectSection` (each updates one section's `status` and, for edit, its content, attributing edits to the user per the universe-review spec); `addHouseRule(draftId, ownerId, ruleText)` appending a `source: 'user'` rule pack entry; `markFactAsAu(draftId, ownerId, section, path, divergenceNote)` recording the mark in a top-level `draft.auMarks` side-array (not a `markedAu` flag on the fact itself — see `draft.ts`'s `AuMark` doc comment: the original fact must stay byte-for-byte unchanged, which a flag mutating the fact wrapper couldn't guarantee) without deleting or altering the original value.
- [x] 5.2 `apps/web/src/lib/research/review.test.ts`: accept/edit/reject transitions on a section; house rule appended with correct `source`; AU mark retains original value alongside the divergence note.

## 6. Publish path

- [x] 6.1 `apps/web/src/lib/research/publish.ts`: `draftToUniverseVersionInput(draft): UniverseVersionInput` mapping accepted sections to `{ name, entitySchema, progressionModel, progressionConfig }`; throws a typed `DraftIncompleteError` naming the missing section when Schema Derivation (or any section required for a valid `UniverseVersionInput`) is not `accepted`/`edited`.
- [x] 6.2 Same file: `publishDraft(draftId, ownerId)` — loads the draft, maps it, calls the existing `createUniverse` from `apps/web/src/lib/engine/universes.ts` unchanged, then updates `universe_drafts.status = 'published'`, `.universe_id`, `.published_version`. Never deletes the draft row.
- [x] 6.3 `apps/web/src/lib/research/publish.test.ts`: full accepted draft publishes and produces a real `UniverseVersion` via the (mocked) `createUniverse` call; publish blocked with a named-section error when schema derivation was rejected; published draft row retains its history and gains `universe_id`/`published_version`.

## 7. UI: new universe flow

- [x] 7.1 `apps/web/src/app/universes/new/page.tsx`: form for name, optional source text, canon cutoff, AU notes; submits to a server action calling `createDraft`, redirects to the review page.
- [x] 7.2 `apps/web/src/app/universes/[draftId]/review/page.tsx`: subscribes to `research_jobs` via Supabase Realtime for live per-stage status; renders each section using its `status` (pending/accepted/edited/rejected) once available.
- [x] 7.3 `apps/web/src/app/universes/[draftId]/review/section-review.tsx`: per-section accept/edit/reject controls; renders confidence badge + source per fact; freeform house-rule input; "mark as AU" control with a divergence-note field.
- [x] 7.4 `apps/web/src/app/universes/[draftId]/review/rerun-diff.tsx`: re-run button per stage; structural diff view between `previous_output` and `output` after a re-run completes.
- [x] 7.5 `apps/web/src/app/universes/[draftId]/review/publish-button.tsx`: calls `publishDraft`; surfaces `DraftIncompleteError`'s named section inline rather than a generic failure; on success links to the new universe/story-creation flow.
- [x] 7.6 Verified via `npm run build` (compiles cleanly, both new routes + `/api/inngest` registered) and the existing unit test suite. A live browser click-through was not performed — same reason as Phase 2 task 7.5: it requires a signed-in session (magic-link email) that can't be driven non-interactively in this environment.

## 8. Docs (Docusaurus)

- [x] 8.1 `docs/docs/phases/phase-3-research-pipeline.md`: mirrors `phase-2-universe-system.md`'s structure — scope, exit criteria, what shipped/didn't, key design decisions (esp. decision 1's RLS exception and decision 2's single-function orchestration), database objects, verification, local Inngest dev instructions, links to architecture docs.
- [x] 8.2 `docs/docs/architecture/research-pipeline.md`: new page — the 8 stages, the durable-job model, stage skip logic, confidence/gaps reporting, failure-and-continue behavior.
- [x] 8.3 `docs/docs/architecture/universe-review.md`: new page — draft document shape, accept/edit/reject/AU-mark/house-rule semantics, re-run diffing, the publish mapping into Phase 2's `UniverseVersionInput`.
- [x] 8.4 `docs/sidebars.ts`: add `architecture/research-pipeline`, `architecture/universe-review`, `phases/phase-3-research-pipeline`.
- [x] 8.5 `docs/docs/phases/build-order.md`: Phase 3 row updated to link its page, marked "Status: implemented."
- [x] 8.6 `docs/docs/reference/data-model.md`: add `universe_drafts`/`research_jobs` tables; note the RLS-exception rationale. Also corrected a stale forward-looking note in `universe-versioning.md` and `data-model.md`'s "Phase 3 replaces [extraction_queue] with a durable job runner" line — design.md decision 2 kept `extraction_queue` as-is, so the docs said something the implementation didn't do.
- [x] 8.7 `npm run build` inside `docs/` — clean, no broken links.

## 9. Verification

- [x] 9.1 From `apps/web`: `npm test` (180/180 passing), `npm run typecheck` (clean), `npm run build` (compiles, all routes generated including `/universes/new`, `/universes/[draftId]/review`, `/api/inngest`) — all three pass. `docs/` `npm run build` also verified clean separately (task 8.7).
- [x] 9.2 `openspec validate phase-3-research-pipeline --strict` passes.
- [x] 9.3 Exit criterion verified via integration test (`run-research-pipeline.test.ts`), not manually: drives the real exported Inngest handler (`runResearchPipeline.fn`) end to end against a fake `step.run` (awaits its callback immediately) and mocked gateway/database, submitting "Jujutsu Kaisen" as the draft name. Confirms all 8 stages resolve to `complete`/`skipped`, the draft reaches `ready_for_review`, and the gaps report is non-empty (the canned fixtures include real low-confidence facts). A second test confirms a failed stage (entities) doesn't abort the run — downstream stages still complete and the failure is listed in the gaps report. A live click-through wasn't possible in this environment (same reason as task 7.6 — no drivable signed-in session), and real API latency against the 15-minute target isn't something CI can measure, so timing is not asserted; the test proves the pipeline's *logic* reaches the exit state, which is what's actually verifiable here.
