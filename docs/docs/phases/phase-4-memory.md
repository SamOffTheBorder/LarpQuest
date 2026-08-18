---
sidebar_position: 5
title: Phase 4 — Memory
---

# Phase 4 — Memory

**Status:** Implemented
**Spec location:** `openspec/changes/archive/2026-08-18-phase-4-memory/`

Phase 4 is build plan Part 6: the full `assembleContext` function, per-chapter memory generation, vector retrieval, per-universe context policy, and long-story arc compaction. Phase 1's `assembleContext` was written with the signature this phase keeps — nothing here touches a caller's shape, only what it's handed.

**Exit criteria:** A 30-chapter story maintains continuity on details established in chapter 3.

## What ships

- **Per-chapter memory** — a structured summary (`summarizer` role) and an embedding of that summary (`embedder` role, not the raw prose), generated strictly after publish via a worker mirroring the extraction worker's non-blocking guarantee
- **`memory_queue`** — its own queue table (not a job type folded into `extraction_queue`), same claim/stale-recovery shape
- **Retrieval** — `retrieveRelevantSummaries` ranks chapter and arc summaries by cosine similarity via two new Postgres RPCs (`match_chapter_summaries`, `match_arc_summaries`), scoped to one story, one code path for every universe
- **Arc compaction** — beyond 50 chapters, one summary per closed 12-chapter arc, generated inline by the same worker that just processed that chapter's own memory
- **Context policy** — `recent_chapters` / `retrieved_chapters` / `retrieval_bias` / `canon_compression` / `token_budget`, immutable per universe version, defaulted for versions and stories that predate it
- **Canon compression** — `summary`/`rules_only` variants of a universe's canon bible generated synchronously at version publish, so a published version is never observed partially-ready
- **`assembleContext` extended** — a RETRIEVED section (deduped against RECENT) and a resolved canon-bible text input, both rendered without the function performing any database read or losing its purity

## What does not ship

A UI for authoring or editing `context_policy` — stored and defaulted, not exposed in a form yet · re-embedding/backfill tooling for chapters published before this phase — they simply have a null `embedding` and are excluded from retrieval · wiring the research pipeline's rules/entities/timeline/rule-pack draft sections into a universe version's canon bible for compression — `canonBible` is accepted as an optional input to `createUniverse`/`publishUniverseVersion`, but `research/publish.ts`'s draft-to-input mapping was not extended to supply it this phase, so research-created universes get null compressed variants until that mapping is added · any change to the turn loop, submission flow, or validation pipeline — this phase only changes what goes into the prompt.

## Capabilities specified

| Capability | Covers |
|---|---|
| `chapter-memory` | Per-chapter summary/embedding generation (non-blocking), arc-summary compaction |
| `context-policy` | Per-universe-version context policy and synchronous compressed canon bible generation |
| `context-assembly` (modified) | `assembleContext`'s RETRIEVED section and canon-bible-text input |

## Key design decisions

### `memory_queue` mirrors `extraction_queue` rather than extending it

Summary/embedding generation and state-diff extraction are separate failure domains that succeed and fail independently. Rather than add a job-type column to the existing, already-tested `extraction_queue`, Phase 4 adds a structurally identical sibling table — the same choice [Phase 3](/phases/phase-3-research-pipeline) made for `research_jobs`. `chapters.memory_status` is likewise a second, independent column next to `extraction_status`.

### Retrieval bias lives in prompt content, never in ranking code

`context_policy.retrieval_bias` shapes the instruction given to the `summarizer` role when a chapter or arc summary is generated — never a branch inside `retrieveRelevantSummaries`. Every universe's retrieval runs the identical cosine-similarity code path; what differs is which summaries were written to be found. A structural test (`memory/genre-agnosticism.test.ts`) guards this the same way Phase 2's engine-wide scanner guards the rest of the codebase against a genre conditional.

### Canon compression is synchronous, at publish

`canon_bible_summary`/`canon_bible_rules_only` are generated inside `publish_universe_version`/`create_universe_with_version`, before the RPC returns — not queued for later, unlike chapter-publish artifacts. Universe-version publish is a rare, deliberate action that already follows the multi-minute research pipeline; a published version being observably complete the moment it exists was judged more valuable than shaving a few seconds off an already-slow, infrequent operation. See [Memory & Context](/architecture/memory-and-context#canon-compression-happens-once-at-publish-not-per-turn).

### Arc compaction piggybacks on the chapter memory worker

Rather than a scheduled sweep, the same worker that just generated a chapter's own summary/embedding checks whether that chapter closed a 12-chapter arc past the 50-chapter threshold, and if so generates the arc summary inline. This is fully determined by chapter count, so no new scheduling primitive was needed.

### `assembleContext` stays pure

Retrieval and canon-bible resolution both happen in the caller (`turns.ts`'s `buildTurnContext`), never inside `assembleContext` itself — it only ever renders text and numbers it's handed. This preserves the existing context-assembly spec's "no persistence side effect, byte-identical output for unchanged inputs" requirement exactly as Phase 1 defined it.

## Database objects

Created in Phase 4: `memory_queue`, `arc_summaries`, `chapters.embedding`/`memory_status`, `universe_versions.context_policy`/`canon_bible_summary`/`canon_bible_rules_only`. New RPCs: `claim_memory_job`, `match_chapter_summaries`, `match_arc_summaries`; `create_universe_with_version`/`publish_universe_version` gained `context_policy`/canon-bible parameters (required dropping and recreating both functions, since `create or replace` cannot change a parameter list). The `vector` extension is installed here, in a dedicated `extensions` schema per Supabase's advisor guidance rather than `public`.

→ [Full data model](/reference/data-model)

## Verifying the phase

- `memory/generate.test.ts` — chapter memory returns a complete outcome with summary + embedding on success; a malformed/failing summarizer or a failing embedder each produce a typed failed outcome without throwing; usage is recorded for every attempt
- `memory/arc-compaction.test.ts` — `shouldCompactArc` boundary tests at every arc edge; a generated arc summary is built from chapter summaries, not prose, and a failed call writes no row
- `engine/memory-worker.test.ts` — a claimed job generates and persists memory without touching `extraction_status`/`extracted_diffs`/`prose`/`published_at`; a failure leaves the chapter published and readable; an arc boundary crossing triggers compaction, a non-boundary chapter does not
- `engine/universes.test.ts` — a published version has both compressed canon-bible variants populated when a canon bible is supplied, and null variants (without a model call) when it isn't; omitted `context_policy` yields the documented defaults; a version's policy is independent of a later version's
- `engine/context.test.ts` — retrieved summaries render and dedupe correctly against RECENT; canon bible text renders when present; the function remains deterministic and side-effect-free; omitting every new input reproduces exact Phase 1 output byte-for-byte
- `memory/retrieval.test.ts` — chapter and arc matches rank together by similarity; results are capped at K; an empty story returns `[]` without erroring; every match query is scoped to its `story_id`
- `memory/genre-agnosticism.test.ts` — no branch on `retrieval_bias`, genre, or a specific fixture universe inside `retrieval.ts`
- `npm test` (218/218 passing), `npm run typecheck`, `npm run build` all pass from `apps/web`; `supabase db advisors --linked` and the RLS coverage test both clean after every migration

## Working the phase

```bash
openspec show phase-4-memory
openspec status --change phase-4-memory
openspec validate phase-4-memory
```

→ [Spec workflow](/reference/spec-workflow)
