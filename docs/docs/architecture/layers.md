---
sidebar_position: 2
title: The Five Layers
---

# The Five Layers

The system separates data by **how mutable it is**. This separation is what makes long stories tractable.

| Layer | Mutability | Purpose |
|---|---|---|
| **Canon** | Curated, versioned | The universe bible. Rules, established facts, power scaling, tone. Produced by research, corrected by humans. |
| **Schema** | Per-universe | Defines what an entity *is* in this universe. Drives forms, validation, and state extraction. |
| **Entity** | Live, versioned | Characters, factions, locations, items. Structured records conforming to Schema. |
| **Narrative** | Append-only | Chapters. Prose + summary + embedding + extracted diffs. |
| **Context Pool** | Ephemeral | The assembled prompt. Built fresh every turn, never stored. |

## Why the separation matters

Each layer changes at a different rate, and mixing rates is what causes drift.

**Canon changes rarely, deliberately, and by a human.** It is versioned because editing it mid-story must not retroactively invalidate 40 published chapters. A story pins a universe version and opts into upgrades.

**Schema changes per universe, not per story.** It is the contract that lets one engine serve every genre.

**Entities change constantly** — every chapter may alter them. Every change writes a history row, so state is reconstructible and reversible.

**Narrative is append-only.** Chapters are never edited in place by the engine. Unpublishing reverses the *diffs* a chapter applied; it does not rewrite history.

**The Context Pool is not stored at all.**

## The Context Pool is a function

:::info The most important function in the codebase
```
assembleContext(story, turn) -> string
```
:::

It is not a database table. Every turn, it is rebuilt from the layers below it. This matters because a stored context would immediately go stale, and a stale context is exactly the drift the architecture exists to prevent.

See [Context Assembly](/architecture/context-assembly) for what it includes and how it stays within budget.

## Layer availability by phase

Not every layer exists from day one. The [build order](/phases/build-order) instantiates them progressively:

| Layer | Arrives in |
|---|---|
| Entity | Phase 1 (schemaless), schema-validated from Phase 2 |
| Narrative | Phase 1 |
| Context Pool | Phase 1 (no retrieval), completed Phase 4 |
| Schema | Phase 2 |
| Canon | Phase 3 |

Phase 1 deliberately runs with entities as opaque `jsonb` and no schema enforcement — proving the [turn loop](/architecture/turn-loop) is genuinely generic before per-universe vocabulary is layered on. Phase 2's [Schema System](/architecture/schema-system) adds validation only for stories that opt into a universe; a story without one keeps Phase 1's schemaless behavior permanently.
