---
sidebar_position: 1
slug: /
title: Introduction
---

# StoryForge

**A universe-agnostic, multiplayer, AI-driven collaborative fiction engine.**

StoryForge runs long-form collaborative stories in any fictional universe. A group creates a universe, claims characters, submits what they do each turn, and the engine writes the chapter — while keeping the world coherent across dozens of chapters.

The hard problem is not writing prose. It is **staying consistent at chapter 60**. Most AI storytelling degrades because it asks a language model to remember a long conversation. StoryForge instead keeps a structured database of world state and renders prose from it.

## The three ideas

Every architectural decision in this project traces back to one of these. If a design choice conflicts with one, the design choice is wrong.

1. **[Prose is disposable. State is permanent.](/architecture/core-thesis)** Chapters are output, not source of truth.
2. **[The engine knows nothing about any specific fiction.](/architecture/schema-system)** No hardcoded notion of magic, combat, or power level.
3. **[Research before writing.](/phases/build-order)** A Canon Bible is researched and human-corrected before a story begins.

## Where to start

| If you want to… | Read |
|---|---|
| Understand why the system is shaped this way | [Core Thesis](/architecture/core-thesis) |
| See how a chapter actually gets made | [The Turn Loop](/architecture/turn-loop) |
| Understand how one engine runs every genre | [Schema System](/architecture/schema-system) |
| Know what gets built when | [Build Order](/phases/build-order) |
| Start implementing | [Phase 1 — Generic Core](/phases/phase-1-generic-core) |
| Look up a table or a prompt | [Reference](/reference/data-model) |

## Repository layout

```
apps/web/     Next.js 15 App Router — the engine and UI
docs/         This documentation site (Docusaurus)
openspec/     Spec-driven change proposals
STORYFORGE_BUILD_PLAN.md      The authoritative implementation spec
UNIVERSAL_STORY_GM_PROMPT.md  The single-chat prototype this productizes
```

:::note The build plan is authoritative
`STORYFORGE_BUILD_PLAN.md` at the repo root is the source of truth for the implementation. This site explains and organizes it; where the two disagree, the build plan wins.
:::

## Current status

Phase 1 (Generic Core) is specified and ready to implement. See [Phase 1](/phases/phase-1-generic-core) for the proposal, specs, design, and task breakdown, all tracked in `openspec/changes/phase-1-generic-core/`.
