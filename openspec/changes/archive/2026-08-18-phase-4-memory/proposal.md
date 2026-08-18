## Why

Phase 1's `assembleContext` only includes the last N chapters in full prose — nothing else. Past a handful of chapters, anything established earlier (a character's backstory detail from chapter 3, a promise made in chapter 7) silently falls out of the model's context and the story starts contradicting itself. Phase 4 closes that gap: every published chapter gets a structured summary and embedding, retrieval pulls the top-K most relevant past summaries into context alongside the recent window, and long stories (50+ chapters) compact into arc-level summaries so context growth stays roughly flat instead of linear. This is Part 6 of `STORYFORGE_BUILD_PLAN.md`, the next phase in the fixed build order (Part 10) now that Phase 3 (Research Pipeline) is complete and archived.

## What Changes

- On chapter publish, generate a structured summary (what happened, who was involved, what changed) and an embedding of that summary — not the prose — using the `summarizer` and `embedder` model roles (already registered in `apps/web/src/lib/ai/roles.ts`, unused until now).
- Add the `vector` extension and a `chapters.embedding vector(1536)` column (deliberately deferred from the Phase 1/3 chapters migration for exactly this phase).
- Extend `assembleContext` to add a RETRIEVED section: top-K chapter summaries by vector cosine similarity to the current turn's input, biased by the universe's `context_policy.retrieval_bias`. The existing ALWAYS/RECENT/CURRENT sections and the function's signature stay as Phase 1 defined them — Phase 4 extends, it does not replace.
- Add a per-universe `context_policy` (`recent_chapters`, `retrieved_chapters`, `retrieval_bias`, `canon_compression`, `token_budget`) stored on the universe version, with defaults when a universe predates this column.
- Add canon compression to context assembly: the Canon Bible can be included `full`, `summary`, or `rules_only` per policy, instead of Phase 1's raw tone-directives stand-in.
- Add arc-summary compaction: beyond ~50 chapters, generate one summary per 10–15-chapter arc; retrieval uses arc granularity for distant history and chapter granularity for recent history, so context size does not grow linearly with story length.
- Summary/embedding generation hooks into the existing post-publish extraction-worker path (`apps/web/src/lib/engine/extraction-worker.ts`) as a sibling step — publication itself is never blocked or delayed by it, matching the extraction non-negotiable.

## Capabilities

### New Capabilities
- `chapter-memory`: per-chapter structured summary + embedding generation on publish (non-blocking), and arc-summary compaction beyond ~50 chapters.
- `context-policy`: the per-universe `context_policy` configuration (recency/retrieval/compression/token-budget knobs) and its defaults.

### Modified Capabilities
- `context-assembly`: `assembleContext` gains a RETRIEVED section (top-K vector-similarity chapter/arc summaries) and canon-bible compression driven by `context_policy`, extending — not replacing — the Phase 1 signature and its ALWAYS/RECENT/CURRENT sections.

## Non-goals

- No change to the turn loop, submission flow, or generation/validation pipeline — this phase only changes what goes *into* the prompt, not how a turn is submitted or generated.
- No UI for authoring or editing `context_policy` — it is stored and defaulted, editable later (Phase 8 UI design pass or sooner if a real need appears), not exposed in a form this phase.
- No change to the Research Pipeline's stage outputs or review UI (Phase 3, already shipped).
- No multiplayer, validation/gatekeeping, or turn-mode work — those are Phases 5–7 and stay untouched.
- No re-embedding or backfill tooling for chapters published before this phase ships in a given story; existing chapters simply have a null `embedding` and are excluded from retrieval until (if ever) a backfill is run as separate, explicitly-scoped work.

## Impact

- **Schema**: new migration adding `vector` extension, `chapters.embedding vector(1536)`, an `ivfflat` index on it, a new `arc_summaries` table (per Part 8.2's schema), and a `context_policy jsonb` column on universe versions.
- **Code**: `apps/web/src/lib/engine/context.ts` (`assembleContext` extension), a new `apps/web/src/lib/memory/` module (summary generation, embedding, retrieval, arc compaction), a hook added alongside `apps/web/src/lib/engine/extraction-worker.ts`.
- **Model roles**: first real usage of the `summarizer` and `embedder` roles defined in `apps/web/src/lib/ai/roles.ts`.
- **Docs**: new `docs/docs/architecture/memory-and-context.md`, `docs/docs/phases/phase-4-memory.md`, sidebar and data-model/build-order updates.
