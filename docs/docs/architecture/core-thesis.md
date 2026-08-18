---
sidebar_position: 1
title: Core Thesis
---

# Core Thesis

Three ideas drive every architectural decision. If a design choice conflicts with one of these, the design choice is wrong.

## 1. Prose is disposable. State is permanent.

Generated chapters are the *output*, not the source of truth. The source of truth is a structured database of entities, world facts, and relationships.

Chapters are rendered from state, and state is updated from chapters.

```
      ┌──────────────┐
      │  Structured  │
      │    State     │ ◄──── extraction ────┐
      └──────┬───────┘                      │
             │                              │
        assembly                        ┌───┴────┐
             │                          │ Prose  │
             └────── generation ──────► │Chapter │
                                        └────────┘
```

A story that has run 100 chapters must be as coherent as one that has run 5. That is only possible if the AI reads structured state rather than trying to remember prose.

**What this rules out:** any design where the model's context window is the memory. Any feature that requires re-reading old chapters to know a fact. Any shortcut that skips [state extraction](/architecture/turn-loop#8-extract) to ship faster.

## 2. The engine knows nothing about any specific fiction

No hardcoded concept of "power level," "magic," "combat," or "abilities."

A universe defines its own vocabulary via [schema](/architecture/schema-system). The same engine must run a superhero war, a courtroom drama, a cozy village mystery, and a hard sci-fi negotiation **without a single conditional branching on genre**.

:::danger The test
If any launch template requires a special case in engine code, the abstraction is wrong and must be fixed before Phase 7 — not worked around.
:::

The engine provides a fixed set of [field type primitives](/architecture/schema-system#field-types). Universes compose them. The engine never adds a domain-specific type.

## 3. Research before writing

Before a story begins, the system conducts deep automated research into the target universe and produces a **Canon Bible** that the human owner reviews and corrects.

Everything downstream depends on this artifact being accurate:

- **Validation** checks chapters against canon rules
- **Progression gating** uses the documented power system
- **Tone enforcement** uses the researched genre register

This is the single highest-leverage feature in the product. It is also why the research pipeline gets its own phase and a mandatory [human review step](/phases/build-order#phase-3--research-pipeline) — research will sometimes be wrong, and users will want deliberate divergence from canon.

## Why these three, together

Each idea covers a failure mode that kills long AI stories:

| Failure | Prevented by |
|---|---|
| The model forgets what happened in chapter 12 | Permanent state |
| The engine can only do the genre it was built for | Universe-agnostic schema |
| The world's rules are whatever the model improvises | Researched canon |

Drop any one and the other two cannot compensate.
