---
sidebar_position: 5
title: Context Assembly
---

# Context Assembly

```
assembleContext(story, turn) -> string
```

The single most important function in the codebase. Everything about long-story coherence comes down to what this function puts in front of the narrator.

It is a **pure function**: same inputs, same output, no writes. A failed generation leaves no context residue, and the assembled prompt is never stored — a stored context goes stale immediately, and stale context is exactly the drift the architecture exists to prevent.

## What it assembles

```
assembleContext(story, turn):
  ALWAYS:
    - Canon Bible (compressed; full rules, condensed lore)
    - Entity Schema
    - All entities with status = active
    - World ledger (deaths, destructions, unresolved threads, active threats)
    - Story tone/style directives

  RECENT:
    - Last N chapters in full prose (default 2–3)

  RETRIEVED:
    - Top-K chapter summaries by vector similarity to current turn input
    - Biased per universe context_policy

  CURRENT:
    - This turn's scene setup
    - All player submissions
    - Any Gatekeeper rulings from this turn
```

The four groups are ordered by how reliably they must be present. `ALWAYS` content is the world's current truth and is never dropped. `RECENT` is continuity. `RETRIEVED` is relevant history. `CURRENT` is what the chapter must actually address.

## Context policy

Retrieval is tuned per universe, because different genres need different history:

```json
{
  "recent_chapters": 3,
  "retrieved_chapters": 5,
  "retrieval_bias": "precedent|information|emotional|thematic",
  "canon_compression": "full|summary|rules_only",
  "token_budget": 24000
}
```

| Bias | For | The question it answers |
|---|---|---|
| `precedent` | Action universes | "How did this power work before?" |
| `information` | Mysteries | "What has been revealed, and to whom?" |
| `emotional` | Drama | "What is the history between these characters?" |
| `thematic` | Literary | "What motifs are running?" |

A mystery retrieving on emotional similarity would surface the wrong chapters entirely — hence the per-universe setting rather than one global retrieval strategy.

## Per-chapter artifacts

On publish, each chapter generates the material assembly later draws on:

- **Full prose** — for humans
- **Structured summary** — what happened, who was involved, what changed
- **Embedding** — of the *summary*, not the prose
- **Extracted diffs** — the state changes
- **Entity index** — which entities appeared, for filtered retrieval

:::tip Embed the summary, not the prose
A summary embeds what the chapter *was about*. Prose embeds its incidental vocabulary — a fight scene and an unrelated argument can look similar in embedding space because both are tense and loud. The summary is the better retrieval signal.
:::

## Token budget

When assembled content would exceed the budget, the function drops in a defined priority order rather than truncating mid-structure:

1. Oldest full-prose chapters go first
2. Entity state, world ledger, and current submissions are retained
3. Whole records are dropped, never half an entity or half a chapter
4. If required content alone exceeds the budget, raise an explicit error naming what could not fit — never silently send an over-budget prompt

## Long-story compaction

Beyond roughly 50 chapters, linear context growth becomes untenable. The system generates **arc summaries** — one per 10–15 chapters — and retrieves at two granularities:

- **Arc granularity** for distant history
- **Chapter granularity** for recent history

This keeps assembled context roughly constant as a story grows, which is what allows a 100-chapter campaign to run on the same budget as a 20-chapter one.

## What's implemented (Phase 4)

Retrieval, canon compression, and arc compaction are implemented, exactly on the Phase 1 signature — no caller needed to change. `assembleContext` still performs no writes and no database reads; the caller (`buildTurnContext` in `turns.ts`) resolves the pinned universe version's `context_policy`, runs retrieval, and resolves compressed canon-bible text upstream, then hands `assembleContext` plain data to render. See [Memory & Context](/architecture/memory-and-context) for the generation, retrieval, and compaction mechanics behind what this function receives.

One difference from the design sketch above: `RETRIEVED` biases the *summaries being ranked*, not the ranking function itself. `retrieval_bias` shapes the prompt used to generate a chapter or arc summary (see [Memory & Context](/architecture/memory-and-context#retrieval-bias-is-a-prompt-instruction-not-a-ranking-strategy)) — the similarity search itself is one code path, unconditional on genre, universe, or bias, per CLAUDE.md's non-negotiable #1.

Gatekeeper rulings in `CURRENT` remain a Phase 6 addition — not present in the assembled prompt yet.

## Phase 1 form (superseded)

Phase 1 shipped this function with **no retrieval and no compression** — active entities, world ledger, tone, recent chapters, scene setup, submissions. It used the signature Phase 4 kept, which is why the sections above landed without touching a single existing caller.
