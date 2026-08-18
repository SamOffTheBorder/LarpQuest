# StoryForge

**A universe-agnostic, multiplayer, AI-driven collaborative fiction engine.**

StoryForge runs long-form collaborative stories in any fictional universe. The hard problem is not writing prose — it is staying coherent at chapter 60. Rather than asking a model to remember a long conversation, StoryForge keeps a structured database of world state and renders prose from it.

## Repository layout

```
apps/web/                       Next.js 15 App Router — the engine and UI
docs/                           Documentation site (Docusaurus 3)
openspec/                       Spec-driven change proposals
STORYFORGE_BUILD_PLAN.md        The authoritative implementation spec
UNIVERSAL_STORY_GM_PROMPT.md    The single-chat prototype this productizes
```

## Getting started

```bash
# Documentation site
cd docs && npm install && npm start          # http://localhost:3000

# Web app
cd apps/web && npm install && npm run dev    # http://localhost:3000
```

Both default to port 3000 — run them on different ports if you need both at once.

## The three ideas

Every architectural decision traces back to one of these. If a design choice conflicts with one, the design choice is wrong.

1. **Prose is disposable. State is permanent.** Chapters are output, not source of truth.
2. **The engine knows nothing about any specific fiction.** No hardcoded notion of magic, combat, or power level. Zero genre conditionals in engine code.
3. **Research before writing.** A Canon Bible is researched and human-corrected before a story begins.

## Current status

**Phase 1 (Generic Core) is specified and ready to implement.**

The full proposal, six capability specs, design document, and task breakdown live in `openspec/changes/phase-1-generic-core/`.

```bash
openspec show phase-1-generic-core
openspec status --change phase-1-generic-core
openspec validate phase-1-generic-core
```

## Build order

Do not reorder — each phase depends on the last.

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 | Generic Core | One user runs 10 chapters end to end |
| 2 | Universe System | Two structurally different universes, no genre conditionals |
| 3 | Research Pipeline | "Jujutsu Kaisen" → usable universe in under 15 min |
| 4 | Memory | A 30-chapter story recalls details from chapter 3 |
| 5 | Multiplayer | Five people run a story for a week |
| 6 | Validation & Gatekeeping | Unearned power gets a reasoned in-universe rejection |
| 7 | Turn Modes | All six modes, switchable mid-story |
| 8 | Polish | Export, search, share, marketplace |

## Stack

Next.js (App Router) + TypeScript strict · Postgres via Supabase (`jsonb` + `pgvector`) · Supabase Auth and Realtime · Zod for every AI structured output · OpenRouter as the AI gateway with a model per role · Tailwind + shadcn/ui · Vercel

## Documentation

Run the docs site, or read the sources directly:

- [Core Thesis](docs/docs/architecture/core-thesis.md) — why the system is shaped this way
- [The Turn Loop](docs/docs/architecture/turn-loop.md) — how a chapter gets made
- [Schema System](docs/docs/architecture/schema-system.md) — how one engine runs every genre
- [Context Assembly](docs/docs/architecture/context-assembly.md) — the most important function
- [Build Order](docs/docs/phases/build-order.md) — what gets built when
- [Data Model](docs/docs/reference/data-model.md) — tables and RLS
