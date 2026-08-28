---
sidebar_position: 2
title: Phase 1 — Generic Core
---

# Phase 1 — Generic Core

**Status:** Specified, ready to implement
**Spec location:** `openspec/changes/phase-1-generic-core/`

Phase 1 builds the turn loop every later phase extends. It deliberately runs *without* the schema system, so the loop is proven generic before per-universe vocabulary is layered on in Phase 2.

**Exit criteria:** A single user can run 10 chapters end to end.

## What ships

- **Auth** — Supabase magic link, RLS on every table from the first migration
- **Story lifecycle** — create, list, archive; owner membership through `story_members`
- **Schemaless entities** — `{name, description, data: jsonb}`, contents never inspected by the engine
- **Entity history** — every state change is a row, from day one
- **Turn loop** — steps 1–4, 7, 8–9 of the [full loop](/architecture/turn-loop); validation, gating, and indexing arrive later
- **`assembleContext`** — no retrieval, but with the signature Phase 4 will extend
- **AI gateway** — OpenRouter, per-role model map, Zod-validated output, streaming with partial save
- **Cost visibility** — `usage_log` on every call, running cost in the UI

## What does not ship

Entity schemas and progression models (Phase 2) · research pipeline and Canon Bible (Phase 3) · summarization, embeddings, retrieval (Phase 4) · multiplayer beyond a single owner (Phase 5) · validation and the Gatekeeper (Phase 6) · the five other turn modes (Phase 7).

## Capabilities specified

Six spec files, each with testable WHEN/THEN scenarios:

| Capability | Covers |
|---|---|
| `auth-and-accounts` | Magic link, session enforcement, the RLS pattern all tables inherit |
| `story-lifecycle` | Creation, per-story model config, listing, archival |
| `entity-state` | Schemaless records, append-only history, diff application, rollback |
| `turn-loop` | State machine, submission durability, lock, publish-before-extract |
| `context-assembly` | Purity, Phase 1 contents, token budget enforcement |
| `ai-gateway` | Role routing, Zod validation, streaming, cost accounting, key encryption |

## Key design decisions

### RLS from the first migration

Every table gets RLS in the migration that creates it, gated through a `story_members` lookup — even though the owner is the only possible member in Phase 1.

*Why now:* retrofitting policies across a dozen tables while multiplayer semantics are simultaneously in flux is where authorization bugs come from. Writing the policy once against a one-row table costs almost nothing.

### Field-level diffs with optimistic concurrency

A diff is `{entity_id, field, from, to, evidence}`. Application requires `from` to match the entity's current value; a mismatch marks the diff conflicted rather than clobbering.

*Alternative rejected:* whole-object replacement from the extractor. It makes history useless for understanding what changed, and any hallucination silently overwrites unrelated fields.

### Publish before extract, always

Extraction runs after the chapter commits, in a database-backed retry queue. Failure marks the chapter extraction-pending and never touches publication state.

*Why not Inngest yet:* the durable-jobs dependency earns its place in Phase 3, where the research pipeline needs real multi-step orchestration. Adding it here to retry one idempotent call is premature, and the migration path is a straight swap.

### Streaming with incremental persistence

Accumulated prose flushes to a draft row as it arrives, so a timeout leaves recoverable text. At 4–8k tokens per chapter, silently discarding partial output is real money.

### The gateway is the only path to OpenRouter

One client resolves the model from a role, validates structured output through Zod, and writes `usage_log`. Cost accounting and key decryption cannot be bypassed because no other path exists.

The key that client bills is resolved per story by `resolveStoryApiKey(storyId)`: the GM member's saved OpenRouter key, else the story owner's, else the platform `OPENROUTER_API_KEY`. Call sites pass the resolved key into the gateway's injected `apiKey` dependency; they never read the environment directly. Story-less calls (universe research) use `resolvePlatformApiKey()`. Users manage their own key — and pick per-role models from OpenRouter's free-model list — from **Settings → OpenRouter** and a story's **Model settings**. See [Model Roles](/reference/model-roles) for the full picture.

## Database objects

Created in Phase 1: `stories`, `story_members`, `entities`, `entity_history`, `turns`, `submissions`, `chapters`, `extraction_queue`, `api_keys`, `usage_log`.

Deliberately deferred rather than created nullable: `chapters.embedding` and the `vector` extension (Phase 4), `stories.universe_id` and `universe_version` (Phase 2), `universes`, `proposals`, `canon_exceptions`, `arc_summaries`.

→ [Full data model](/reference/data-model)

## Verifying the phase

The task list ends with explicit verification:

- Hand-build **two structurally different** test universes — one with an abilities array, one with only knowledge and social fields
- Run ten chapters end to end on each, confirming no genre-specific code was needed
- Grep engine code for conditionals on genre, universe, or media type; confirm none exist
- Verify chapter 10's consistency against a no-state baseline
- Confirm rollback of a mid-story chapter restores correct entity state

The two-universe test is run *during* Phase 1 rather than waiting for Phase 2's formal exit criterion — catching a leaked genre assumption while the loop is still small.

## Working the phase

```bash
openspec show phase-1-generic-core     # view the change
openspec status --change phase-1-generic-core
openspec validate phase-1-generic-core
```

→ [Spec workflow](/reference/spec-workflow)
