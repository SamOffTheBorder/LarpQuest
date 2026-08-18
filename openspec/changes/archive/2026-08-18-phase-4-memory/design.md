## Context

Phase 1 shipped `assembleContext(story, turn, ...)` (`apps/web/src/lib/engine/context.ts`) with a signature already scoped for this phase: it takes recent chapters and an optional `ContextPolicy` (currently just `recentChapters` + `tokenBudget`), and its own header comment states "Phase 1 does no retrieval and no canon compression. The signature is the one Phase 4 will keep." Nothing here should change that signature's shape for existing callers — only extend it.

The `chapters` table (`supabase/migrations/20260812000004_chapters.sql`) already has `summary`, `entity_ids`, `extracted_diffs`, and an `extraction_status` pending/complete/failed column with a matching `extraction_queue` job table and a stale-claim-recovery worker (`apps/web/src/lib/engine/extraction-worker.ts`, `runOneExtraction`). `embedding` and the `vector` extension were deliberately left out of that migration for this phase, per its own comment.

Universes are versioned and immutable (`universe_versions`, Phase 2): `entity_schema`, `progression_model`, `progression_config` per version, no update/delete path — "editing" means publishing a new version. `context_policy` belongs on the same table for the same reason: a story pins a universe version, and its context behavior should be pinned with it, not silently change when the universe publishes a new version.

Model roles `summarizer` (`anthropic/claude-haiku-4.5`) and `embedder` (`openai/text-embedding-3-small`) are already defined in `apps/web/src/lib/ai/roles.ts` with working `resolveModel` dispatch, but nothing calls them yet.

## Goals / Non-Goals

**Goals:**
- Extend `assembleContext` with vector-similarity retrieval and canon compression, without changing its existing Phase 1 behavior when policy fields are absent (default-compatible).
- Generate a chapter's structured summary + embedding as a non-blocking post-publish step, following the extraction worker's exact failure-isolation pattern.
- Introduce `context_policy` as a `universe_versions` column, immutable per version like every other version field.
- Add arc-summary compaction that activates automatically past ~50 chapters, invisible below that threshold.

**Non-Goals:**
- Backfilling embeddings for chapters published before this migration ships in a given story (see proposal's Non-goals).
- Any UI for editing `context_policy` (defaults + Zod schema only this phase).
- Changing how turns are submitted, generated, or validated — only what feeds the prompt.
- Cross-universe or cross-story retrieval — retrieval is always scoped to one `story_id`.

## Decisions

### 1. A new `memory_queue` table, not reuse of `extraction_queue`

`extraction_queue` is typed around one job kind (state diff extraction) via `claim_extraction_job`. Rather than overload it with a `job_type` discriminant — which would force every future consumer of that RPC to filter by type — Phase 4 adds a parallel `memory_queue` table with the identical shape (`chapter_id`, `status`, `attempt_count`, `last_error`, `claimed_at`) and its own `claim_memory_job` RPC, copy-pasted in structure from the extraction one. Same stale-claim recovery, same `pending/complete/failed` status enum. This mirrors the codebase's existing precedent (research pipeline's `research_jobs` is likewise its own table rather than folded into `extraction_queue`) rather than introducing a new "generic job queue" abstraction that nothing else asked for.

**Alternative considered:** a single polymorphic job queue table. Rejected — no current requirement needs cross-job-type querying, and it would touch the already-shipped, tested `extraction_queue` code path for no behavioral gain.

### 2. `chapters.memory_status`, separate from `extraction_status`

Summary/embedding generation and diff extraction are independent failure domains — one can succeed while the other fails, and each is queued and retried separately. A single combined status would conflate "state didn't update" with "this chapter won't show up in future retrieval," which are different problems with different urgency. `chapters` gets a second column, `memory_status text not null default 'pending' check (memory_status in ('pending','complete','failed'))`, alongside the existing `extraction_status`.

### 3. Summary generation calls the `summarizer` role; embedding is a separate, cheaper call under `embedder`

Two model calls per chapter, not one: `summarizer` produces the structured summary (Zod-parsed, matching the build plan's "what happened, who was involved, what changed" shape), then `embedder` embeds that summary text (not the raw prose — Part 6.1 is explicit that summary embeddings are the better retrieval signal). Both calls go through `callStructured`/the gateway's usage recorder exactly like every other role call, so `usage_log` gets a row for each, including failures, per CLAUDE.md constraint #8.

**Alternative considered:** one combined call that returns both a summary and asks the model to describe embedding-worthy content. Rejected — embeddings come from a dedicated embedding endpoint/model (`openai/text-embedding-3-small`), not a chat completion, so this was never actually one call; keeping them conceptually separate matches what's technically true.

### 4. Retrieval bias is a prompt-shaping instruction, not a different similarity metric

`retrieval_bias` (`precedent|information|emotional|thematic`) does not change the underlying vector search — cosine similarity against the same embedding stays the mechanism for every universe. Bias is expressed by appending a short instruction to the *summary generation* prompt ("emphasize precedent-setting outcomes," "emphasize revealed information," etc.) so the summaries themselves — and therefore what they embed close to — already lean toward what that universe's context policy cares about. This keeps retrieval itself universe-agnostic (no conditional on `retrieval_bias` in the retrieval code path — only in prompt construction, which is data-driven from the policy, not a branch on genre) while still producing the differentiated behavior Part 6.3 describes.

**Alternative considered:** four different similarity/reranking strategies selected by `retrieval_bias`. Rejected — this is exactly the kind of branch CLAUDE.md's non-negotiable #1 forbids in spirit (behavior forking on a universe-supplied category inside engine code); folding the bias into prompt-driven summary content keeps the retrieval *code* identical across every universe.

### 5. Canon compression reuses the `summarizer` role at publish-time-of-universe-version, not per-turn

`canon_compression: 'full'|'summary'|'rules_only'` selects which of three pre-computed representations of the canon bible `assembleContext` reads — it does not run a compression model call on every turn. `summary` and `rules_only` variants of the canon bible are generated once, when a universe version is published (hooking into the existing `createUniverse`/`publish_universe_version` path from Phase 2), and stored alongside `entity_schema` on the `universe_versions` row. `assembleContext` then does a pure column read keyed by policy, preserving its "pure function, no side effects" requirement from the existing context-assembly spec.

**Alternative considered:** compress on every `assembleContext` call. Rejected — violates the existing spec's "no side effect / deterministic without re-computation" framing and would mean a compression-model call (and its cost/latency) on every single turn instead of once per universe version.

### 6. Arc compaction runs as a threshold-triggered job alongside chapter memory generation, not a separate scheduled sweep

After a chapter's own summary/embedding completes, the same worker checks whether `story.current_turn` has just crossed a 10–15-chapter arc boundary past the 50-chapter mark (config: arc size and activation threshold are constants, not per-universe policy — Part 6.4 does not make this configurable) and if so enqueues one arc-summary job covering that closed arc. This keeps compaction naturally paced with story progress instead of needing a cron sweep, and reuses the same `summarizer` role and queue-failure-isolation pattern as chapter memory.

**Alternative considered:** a scheduled nightly job scanning all stories for arc boundaries. Rejected — adds a new operational primitive (a cron/schedule) for behavior that's fully determined by turn count and can piggyback on the per-chapter worker that already runs after every publish.

### 7. RLS on `memory_queue` and `arc_summaries`

`memory_queue` rows are gated through `story_members` via `chapter_id -> chapters.story_id`, matching `extraction_queue`'s existing policy shape exactly. `arc_summaries` (per Part 8.2's schema) is gated through `story_members` via its own `story_id` column, matching `chapters`. Both are service-role-write-only for the actual insert/update path (the worker uses `createServiceRoleClient()`, same as extraction), with `story_members`-gated `select` for members to read.

## Risks / Trade-offs

- **[Risk] Embedding provider dependency** (`openai/text-embedding-3-small` via OpenRouter) is a new external dependency the engine hasn't called before. → Mitigation: goes through the same `callStructured`/gateway usage-recording path as every other role; a failed embedding call marks `memory_status: 'failed'` and is retryable, exactly like extraction — it never blocks publication or generation.
- **[Risk] `ivfflat` index quality degrades on small tables** (needs a reasonable row count to build good clusters) — early stories with few chapters get a weak or default-to-sequential-scan index. → Mitigation: acceptable at this scale (single-story vector counts stay in the hundreds at most before Phase 4's own arc compaction kicks in); revisit index type only if real usage shows a problem.
- **[Risk] Retrieval bias expressed only through prompt instructions** is a softer lever than a real reranking strategy — a "precedent" bias might not measurably change retrieval results if the model doesn't lean into the instruction. → Mitigation: acceptable trade-off to keep retrieval code universe-agnostic (Decision 4); can be revisited without a schema change since it's entirely prompt-level.
- **[Risk] Two-column status (`extraction_status`, `memory_status`) on `chapters`** adds surface area for the two to drift/confuse in the UI. → Mitigation: keep them visually and semantically distinct in any status display (state-extraction vs. memory/retrieval), matching that they already are functionally independent.

## Migration Plan

1. New migration: `create extension if not exists vector`, `chapters.embedding vector(1536)` + `ivfflat` index, `chapters.memory_status`, `memory_queue` table + RLS + `claim_memory_job` RPC, `arc_summaries` table + RLS, `universe_versions.context_policy jsonb not null default '{...defaults...}'::jsonb` (backward-compatible default so Phase 2/3 rows keep working unchanged), `universe_versions.canon_bible_summary`/`canon_bible_rules_only` (or a single `canon_bible_compressed jsonb` holding both) columns, nullable (populated only for versions published after this ships).
2. `supabase db push` against the linked project, then `supabase db advisors --linked` and the RLS coverage test file, per CLAUDE.md's gotchas section.
3. No rollback complexity beyond a standard down-migration — no existing data is mutated, only new nullable/defaulted columns and new tables are added.

## Open Questions

- Exact arc size/activation threshold as hardcoded constants (build plan gives "beyond ~50 chapters," "10–15 chapters per arc" as approximate) — tasks.md will pick concrete numbers (50 and 12) unless there's a reason to differ; flag if the real answer should live in per-universe policy after all.

### Resolved: canon compression is synchronous

`canon_compression`'s `summary`/`rules_only` variants are generated synchronously during universe-version publish, inside the same `publish_universe_version` flow — publish does not return until both compressed variants exist alongside `entity_schema`. Universe-version publish is a rare, deliberate action that already follows the multi-minute research pipeline (Phase 3); two summarization calls add negligible time and, more importantly, mean a published version is never in a partially-ready state — `assembleContext` never needs a null-compression fallback path for a version it's allowed to read. This differs from chapter publish (which must stay instant and never blocks on generated content) because chapter publish happens every turn under time pressure from waiting players, while universe-version publish happens once per canon revision.
