---
sidebar_position: 1
title: Build Order
---

# Build Order

:::danger Do not reorder
Each phase depends on the last. The ordering is not a preference — it is a dependency chain.
:::

| Phase | Scope | Est. |
|---|---|---|
| [1](/phases/phase-1-generic-core) | Generic Core | ~3 weeks |
| [2](/phases/phase-2-universe-system) | Universe System | ~3 weeks |
| 3 | Research Pipeline | ~3 weeks |
| 4 | Memory | ~2 weeks |
| 5 | Multiplayer | ~3 weeks |
| 6 | Validation & Gatekeeping | ~2 weeks |
| 7 | Turn Modes | ~2 weeks |
| 8 | Polish | — |

## Phase 1 — Generic Core

Auth, story creation, single-player. Entities as `{name, description, data: jsonb}` with no schema enforcement. One hardcoded `freeform` turn mode. Full turn loop: submit → assemble → generate → publish. OpenRouter integration with one model role. Chapters saved and displayed.

**Exit criteria:** A single user can run 10 chapters end to end.

→ [Full Phase 1 specification](/phases/phase-1-generic-core)

## Phase 2 — Universe System

**Status: implemented.** Entity Schema definition and storage. Dynamic form rendering from schema. Progression model plugin architecture with two models implemented (`ability_unlock`, `none`). Universe versioning and pinning.

**Exit criteria:** Two structurally different universes — one with powers, one without — run on the same code with **no genre conditionals**.

This is the phase that proves or disproves the whole architecture.

→ [Full Phase 2 specification](/phases/phase-2-universe-system)

## Phase 3 — Research Pipeline

The 8-stage async job, progress streaming, human review UI, draft → published universe flow, confidence and gaps reporting.

**Exit criteria:** Typing "Jujutsu Kaisen" produces a usable universe in under 15 minutes with a reviewable bible.

### The eight stages

| Stage | Produces |
|---|---|
| 1 — Scoping | Classification: media type, genre, power system type, scale ceiling, conflict mode, tone |
| 2 — Rules & Mechanics | Structured rule objects with citations or confidence flags |
| 3 — Power/Progression | How abilities are gained, limits, scaling, tiers, ceiling |
| 4 — Canonical Entities | Characters, factions, locations; status at cutoff |
| 5 — Timeline & Canon State | Where the story starts, what's unresolved |
| 6 — Schema Derivation | The proposed Entity Schema |
| 7 — Rule Pack Generation | Validation rules with severities, including tone rules |
| 8 — Confidence & Gaps | What research could **not** determine |

Each stage is a discrete, individually retryable sub-job writing to a shared draft document.

**Stage 3 matters more than any other for long-running stories** — it becomes the Gatekeeper's reference document.

**Stage 8 is non-negotiable.** Users who cannot see where the bible is guessing will trust it uniformly and be blindsided.

## Phase 4 — Memory

Summarization, embeddings, vector retrieval, context policy, arc compaction, the full [`assembleContext`](/architecture/context-assembly) function.

**Exit criteria:** A 30-chapter story maintains continuity on details established in chapter 3.

## Phase 5 — Multiplayer

Rooms, invites, roles, entity claiming, turn locks and deadlines, realtime presence, conflict resolution policy, safety controls.

**Exit criteria:** Five people run a story together across a week without coordinating outside the app.

### Roles

| Role | Can |
|---|---|
| **Owner** | Everything. Manages universe, keys, billing. |
| **GM** | Open/close turns, override validation, edit entities, revise chapters, invite |
| **Player** | Claim entities, submit actions, propose capabilities, vote |
| **Spectator** | Read only |

### Safety is a requirement, not polish

Multiplayer means people who do not know each other:

- Content rating set at story creation, enforced in the Narrator system prompt
- Report/block at room level
- Owner can remove members and revoke invite links
- Submission-level moderation before content reaches other players
- One player's submission must not steer the story into content another player did not consent to

## Phase 6 — Validation & Gatekeeping

Rule engine with severity levels. Validator loop with retry and escalation. Gatekeeper for proposals. GM override writing canon exceptions. Consistency report view.

**Exit criteria:** A player proposing an unearned power gets a reasoned in-universe rejection.

→ [Validation & Gatekeeping](/architecture/validation-gatekeeping)

## Phase 7 — Turn Modes

Implement the remaining five modes. Mid-story mode switching.

If any launch template required a special case before this point, **fix the abstraction here** rather than working around it.

## Phase 8 — Polish

Image prompt generation as a first-class per-chapter feature. Full-text search across a story. Export to Markdown/PDF/EPUB. Public read-only share links. Mobile-responsive pass. Universe marketplace — browse, clone, fork published universes.

## Non-obvious requirements

Things that will hurt if deferred:

1. **Universe versioning from Phase 2.** Editing canon mid-story must not retroactively break 40 chapters. Pin the version.
2. **Entity history from Phase 1.** Every state change is a row. Without this, rollback is impossible and debugging drift is guesswork.
3. **Submissions independent of generation.** Player input must survive any number of failed generation attempts.
4. **Cost visibility from day one.** At 8k-token chapters, a long campaign is real money. Surprise bills kill products.
5. **The GM override must write to canon.** An override that does not persist means the same fight every chapter.
6. **Tone rules matter as much as mechanical rules.** Genre drift is the most common failure in long AI stories.
7. **Research gaps must be visible.** Otherwise users trust the bible uniformly and get blindsided.
8. **Never block publication on extraction.** Publish, then extract.

## The first milestone

> One user, one universe created by hand (no research), five entities, ten chapters generated with structured state that updates correctly and demonstrably improves chapter 10's consistency versus a no-state baseline.

If that works, everything else is scaling. If it does not, no amount of multiplayer or research will save it.
