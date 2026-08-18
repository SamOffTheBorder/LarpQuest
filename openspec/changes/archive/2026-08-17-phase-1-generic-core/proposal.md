# Phase 1 — Generic Core

**Build-plan phase:** Part 10, Phase 1 (Generic Core). This is the first phase; no earlier phases exist.

## Why

Nothing runs yet. Before universes, research, or multiplayer can be built, the engine needs the loop everything else hangs off: a user creates a story, submits an action, a model writes a chapter, and the resulting state change is recorded as a durable row. Appendix B names this as the smallest thing worth building — if a story's state does not demonstrably improve chapter 10's consistency over a no-state baseline, no amount of research or multiplayer will save the product.

Phase 1 deliberately builds the loop *without* the schema system, so the turn loop is proven generic before per-universe vocabulary is layered on in Phase 2.

## What Changes

- **Auth and accounts** via Supabase Auth (magic link), with RLS enabled on every table from the first migration.
- **Story creation and listing** for a single owner. No members table beyond the owner's row yet, but access is gated through `story_members` from day one so Phase 5 does not require a rewrite of every policy.
- **Schemaless entities** stored as `{name, description, data: jsonb}` with no schema enforcement. Phase 2 introduces the schema; Phase 1 must not anticipate it with genre-specific fields.
- **Entity history from the first migration.** Every state change writes an `entity_history` row. Deferring this makes rollback impossible and state drift undebuggable (Part 11.2).
- **One hardcoded `freeform` turn mode.** Turn modes are a Phase 7 concern; Phase 1 hardcodes exactly one and routes it through the same template dispatch the later modes will use.
- **The turn loop, partially.** Steps 1–4, 7 and 8–9 of Part 1.2: open → submit → assemble → generate → publish → extract → apply. Validation (5), gating (6) and indexing (10) are explicitly out of scope and land in Phases 6 and 4.
- **`assembleContext(story, turn)`** as a pure function with no retrieval and no compression — active entities, world ledger, and the last N chapters in full prose. Phase 4 adds embeddings and retrieval behind the same signature.
- **OpenRouter integration** with the per-role model map in place but only the `narrator` and `extractor` roles populated. Every structured output is parsed through a Zod schema.
- **Cost visibility from day one** (Part 11.4): every model call writes a `usage_log` row, and running story cost is displayed in the UI.
- **Submissions persist independently of generation** (Part 11.3): a failed or timed-out generation never destroys player input, and a `failed` turn is retryable.

## Capabilities

### New Capabilities

- `auth-and-accounts`: Magic-link sign-in, session handling, and the RLS gating pattern all later tables inherit.
- `story-lifecycle`: Creating, listing, opening and archiving a story; owner membership; per-story model and turn configuration.
- `entity-state`: Schemaless entity records plus the append-only `entity_history` ledger and diff application/rollback.
- `turn-loop`: Turn open/lock state machine, submission capture, generation dispatch, publication, and retry of a `failed` turn.
- `context-assembly`: The `assembleContext` function — the single most important function in the codebase — in its no-retrieval Phase 1 form.
- `ai-gateway`: OpenRouter client, the per-role model map, Zod-parsed structured output, streaming with partial save, and `usage_log` cost accounting.

### Modified Capabilities

None. This is the first change; `openspec/specs/` is empty.

## Impact

- **New code:** `apps/web/src/` — route handlers for story/turn/entity operations, the engine modules (`context`, `gateway`, `extraction`), and the reader UI.
- **New database objects:** `stories`, `story_members`, `entities`, `entity_history`, `chapters`, `turns`, `submissions`, `usage_log`, and `api_keys`. Tables from the Part 8.2 schema that belong to later phases (`universes`, `proposals`, `canon_exceptions`, `arc_summaries`) are not created yet; `chapters.embedding` is deferred to Phase 4 with the `pgvector` extension.
- **Dependencies added:** `@supabase/supabase-js`, `@supabase/ssr`, `zod`, and shadcn/ui primitives.
- **External services:** a Supabase project and an OpenRouter API key are required to run the app.
- **Deliberately unaffected:** no genre, universe, or media-type conditional appears anywhere in engine code. The `freeform` mode is selected through the same dispatch table Phase 7 extends, not through a branch.

## Non-goals

- Entity schemas, dynamic form rendering, progression models, and universe versioning — **Phase 2**.
- The 8-stage research pipeline, the Canon Bible, and the human review UI — **Phase 3**. Phase 1 universes are created by hand.
- Summarization, embeddings, vector retrieval, context policy, and arc compaction — **Phase 4**.
- Multiplayer: invites, roles beyond owner, entity claiming, deadlines, realtime presence, conflict resolution, and room safety — **Phase 5**.
- Validation rules, the validator retry loop, the Gatekeeper, and GM overrides writing canon exceptions — **Phase 6**.
- The five non-`freeform` turn modes and mid-story mode switching — **Phase 7**.
- Image prompts, export, search, share links, and the universe marketplace — **Phase 8**.
