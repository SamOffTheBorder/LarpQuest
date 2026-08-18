## Context

Phase 1 gave the engine a turn loop and one `narrator`/`extractor` model call. Phase 2 gave universes a schema and progression model, but every universe (`ASHFALL_LEGION`, `WOVENMERE`) is a hand-written fixture. Phase 3 is the flagship feature from Part 2: a user types a universe name and gets back a reviewable Canon Bible instead of hand-authoring one.

The `researcher` role and its default model (`anthropic/claude-opus-4.1`) already exist in `roles.ts`, unused since Phase 1. `callStructured` in `gateway.ts` already provides the per-role model resolution, Zod validation with one retry, and `usage_log` write on every attempt (success or failure) — Stage calls reuse it as-is rather than inventing a parallel path.

The Phase 1 `extraction_queue` pattern (claim/update a Postgres row, `skip locked`, stale-claim recovery) works for one idempotent retryable call. The research pipeline is 8 *sequential* stages where stages 2–8 read prior stages' output, stage 3 is conditionally skipped, and total wall time is 5–15 minutes with progress the user watches live. Modeling that as hand-rolled Postgres claiming means reimplementing a state machine and a scheduler in SQL. This is the phase the build plan flags for introducing a durable-job orchestrator (Part 10 note under Phase 1, config.yaml tech stack) — Inngest is added here for that reason, not before.

## Goals / Non-Goals

**Goals:**
- Run the 8 stages from Part 2.2 as an Inngest function, each stage a durable step so a crash mid-pipeline resumes from the last completed stage, not from scratch.
- Persist every stage's raw output (`research_jobs.output`) and its accumulated position in the shared draft (`universe_drafts.draft`) so the review UI can render partial progress while later stages are still running.
- Stream stage-level progress to the review UI via Supabase Realtime on `research_jobs` (no polling).
- A review UI that lets a human accept/edit/reject each section, see confidence + source per fact, add house rules, mark facts as AU, and re-run a stage with a diff against the prior output.
- Publishing a reviewed draft calls `createUniverse`/`publishUniverseVersion` unchanged — this phase produces a `UniverseVersionInput`, it does not touch versioning.

**Non-Goals:**
- Source material ingestion beyond plain pasted text / URLs fetched as text (PDF parsing, wiki crawling) — the proposal input accepts a `sourceText` field; building a document-ingestion pipeline is not this phase's scope and isn't blocking the exit criterion.
- Re-deriving progression-model *behavior* — Stage 6 (Schema Derivation) picks a progression model slug from the Phase 2 registry (`resolveProgressionModel`); it never invents new dispatch logic.
- Any validator/Gatekeeper wiring (Phase 6). Stage 7's Rule Pack is generated and stored; nothing evaluates it against gameplay yet.
- Multiplayer review (Phase 5). A draft is owned by one user; no concurrent-editor conflict resolution.

## Decisions

**1. `universe_drafts` and `research_jobs` are user-owned, not story-owned.**
A draft exists before any story or universe does — RLS on both tables is `owner_id = auth.uid()` rather than the `story_members` gate used everywhere else. This is a deliberate, documented deviation from the CLAUDE.md "gated through story_members" default, because the object being protected has no story yet. Once published, the resulting universe row is owned exactly like any Phase 2 universe.

**2. Stage orchestration lives in one Inngest function with 8 steps, not 8 separate functions.**
Alternative considered: one Inngest function per stage, chained by events. Rejected — event-chaining 8 stages multiplies failure surfaces (each hop is a place a job can be dropped) for no benefit here, since stages are inherently sequential and none benefit from independent scheduling. `step.run()` per stage inside one function gives per-step retry and memoization (a completed step is never re-executed on function replay) with one durable execution to reason about. `research_jobs` rows exist for observability and UI progress, not as the source of retry truth — Inngest's step checkpointing is.

**3. Each stage writes its `research_jobs` row itself, from inside `step.run`, not from the orchestrator.**
So the row transitions `queued → running → complete|failed` at the moment the stage actually executes, and a step that Inngest memoizes (replay skips re-running it) does not re-emit a duplicate status write — the write happened on the original execution and is already durable.

**4. Stage 3 (Power/Progression) is skipped via early return keyed on Stage 1's `has_power_system`, using the same "absence is data" shape Phase 2 uses for a null `progression_model`.**
Not a genre conditional: `has_power_system` is a boolean the *research itself* produced for *this* universe, not an engine-level branch on a named genre or universe. The skip is recorded as `research_jobs.status = 'skipped'` (new status alongside `extraction_queue`'s vocabulary) with `output = null`, and Stage 6 (Schema Derivation) reads that status rather than re-deriving the boolean.

**5. Publishing calls the existing Phase 2 functions; this phase does not add a new universe-write path.**
`draftToUniverseVersionInput(draft): UniverseVersionInput` in `apps/web/src/lib/research/publish.ts` maps the accepted draft (post-review, with AU marks and house rules folded in) to the exact shape `createUniverse` already validates via `universeVersionInputSchema`. No new RPC, no new table write for the universe itself — `universe_drafts.status` moves to `published` and stores the resulting `universe_id`/`published_version` for traceability, that's it.

**6. Confidence and AU-marking live on the draft document, not as new columns.**
The draft is `jsonb` shaped as `{ scoping, rules, progression, entities, timeline, schema, rulePack, gaps }`, and confidence/source/AU-flag are per-fact properties inside each section (`{ value, confidence: 'high'|'medium'|'low', source?: string, markedAu?: boolean, houseRule?: string }`), validated by a Zod schema (`draftSectionSchema` family) rather than modeled as relational rows. Alternative considered: a `draft_facts` table with one row per fact for structured accept/reject. Rejected for this phase — the review UI's accept/edit/reject is a document-level operation (replace a JSON subtree) and a fact-per-row model adds a join for no query this phase needs; revisit only if Phase 8's marketplace needs to diff facts across universes at the row level.

**7. Re-run diffing is computed, not stored.**
Re-running a stage overwrites `research_jobs.output` for that stage (previous output kept in `research_jobs.previous_output`, one generation back only) and the UI computes a structural diff client-side between `previous_output` and `output`. No diff-history table — Part 2.3 asks for "a diff view when re-running," not an audit trail of every re-run.

## Risks / Trade-offs

- **[Risk] Opus-tier `researcher` calls across 8 stages make one draft expensive and slow (5–15 min is the target, not a guarantee).** → Mitigation: each stage is its own `step.run`, so a timeout or transient failure retries only that stage (Inngest's built-in step retry, default backoff) rather than restarting the whole pipeline; the UI shows per-stage status so a slow stage doesn't read as a hang.
- **[Risk] A stage's structured-output retry (gateway's built-in 1 retry) still fails, e.g. the model can't produce valid JSON for Stage 4's entity list twice in a row.** → Mitigation: `research_jobs.status = 'failed'` with `last_error` set, pipeline continues to the next stage where the stage's inputs don't strictly require the failed one (documented per-stage in tasks.md), and failed stages are individually re-runnable from the review UI rather than failing the whole draft. Stage 8 (Gaps Report) always runs last and explicitly calls out any failed stage as a gap, so failure is visible rather than silently absent.
- **[Risk] Introducing Inngest is a new hosted dependency and local-dev story.** → Mitigation: Inngest's dev server runs locally via its CLI (`npx inngest-cli dev`) without Docker, consistent with this environment's no-Docker constraint; production registers the same function against Inngest Cloud's free tier, deploy step documented in tasks.md.
- **[Risk] User-owned RLS (decision 1) is an exception to the story_members pattern everywhere else in the codebase — easy to copy incorrectly into a later phase.** → Mitigation: the migration comment and the `universe-review` spec both state explicitly why this table is the one exception, and `genre-agnosticism.test.ts`-style scanning is out of scope here (that test guards genre conditionals, not RLS shape) — a code comment is the guard for this one.
- **[Risk] Long-running streamed progress over Next.js server actions/routes on Vercel has execution-time limits.** → Mitigation: the pipeline runs entirely inside the Inngest function (its own execution environment, not a Next.js request), and the Next.js route only triggers the run (`inngest.send`) and reads status via Realtime/polling the `research_jobs` table — no Next.js request stays open for the pipeline's duration.

## Migration Plan

1. Migration `..._universe_drafts.sql`: `universe_drafts`, `research_jobs` tables, RLS, `touch_updated_at` triggers (reuse existing trigger function from Phase 1).
2. Add `inngest` + `inngest-cli` (dev only) to `apps/web`; add `apps/web/src/inngest/client.ts` and the research-pipeline function; wire the Next.js Inngest route handler at `apps/web/src/app/api/inngest/route.ts`.
3. Ship `apps/web/src/lib/research/*` (pipeline stages, prompts, Zod schemas, `publish.ts`).
4. Ship review UI routes.
5. No data migration — purely additive; nothing in Phase 1/2 schema changes.

Rollback: drop the two new tables and the Inngest route; no existing table gains or loses a column, so rollback has no blast radius on stories/universes already in use.

## Open Questions

- Should Stage 1's `media_type`/`genre_tags` classification ever feed a *display* label (e.g. "Shonen" shown in the UI) versus staying pure data the engine never branches on? Current design: yes, displayed verbatim as researched text, never matched against a fixed enum in code — consistent with Part 0.2, but worth re-confirming when the review UI is actually built.
- Exact Inngest step-retry/backoff tuning (attempt count, delay) is left to implementation defaults documented inline; no build-plan requirement pins a specific number.
