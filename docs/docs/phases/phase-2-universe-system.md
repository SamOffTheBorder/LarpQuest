---
sidebar_position: 3
title: Phase 2 — Universe System
---

# Phase 2 — Universe System

**Status:** Implemented
**Spec location:** `openspec/changes/phase-2-universe-system/`

Phase 2 gives universes a way to declare what an entity *is* (the [Schema System](/architecture/schema-system)) and how entities change over time ([progression models](/architecture/schema-system#progression-models)), without the engine ever knowing what a "power" or a "faction standing" is. This is the phase that proves or disproves the core architecture: if two structurally incompatible universes can't run on identical code, the abstraction is wrong.

**Exit criteria:** Two structurally different universes — one with powers, one without — run on the same code with **no genre conditionals**.

## What ships

- **Entity Schema** — per-universe-version field definitions drawn from the eleven [engine primitives](/architecture/schema-system#field-types); schema storage, a Zod-based validator compiled from it, and dynamic entity forms rendered from it
- **Progression model dispatch table** — mirrors the [turn-mode dispatch table](/architecture/turn-loop); registers `none` and `ability_unlock`, the two Phase 2 requires
- **Universe versioning** — universes are named, owned, and versioned independently of any story; versions are immutable; stories pin a specific version and upgrade only through an explicit owner action
- **Schema-validated entity writes** — a story with a pinned universe version validates entity `data` against that version's schema on every write; a story without one keeps Phase 1's fully unconstrained behavior, permanently
- **Two proof fixtures** — Ashfall Legion (power-scaling, `ability_unlock`) and Wovenmere (social-only, `none`), each with a real schema, run through identical engine code

## What does not ship

Automated schema derivation from research (Phase 3) · the Gatekeeper and any semantic/business-rule validation — Phase 2 validates field *shape*, never transition *legality* beyond the `ability_unlock` lifecycle (Phase 6) · `numeric_scaling` and the other five progression models Part 4 anticipates (introduced as research makes them necessary, same dispatch table) · universe marketplace, forking, or public browsing (Phase 8) · a visual schema-authoring UI (universes are hand-authored or seed-scripted this phase).

## Capabilities specified

| Capability | Covers |
|---|---|
| `entity-schema` | Schema definition and storage, field-type validation, dynamic form rendering |
| `universe-versioning` | Universe as an independent versioned record, immutable versions, story pinning |
| `progression-models` | Dispatch table, `none`, `ability_unlock`, the structural genre-agnosticism proof |
| `entity-state` (modified) | Entity writes validated against a pinned schema when one exists |
| `story-lifecycle` (modified) | Story creation accepts an optional universe pin; explicit upgrade path |

## Key design decisions

### Versions are immutable; "editing" inserts a new row

`universe_versions` has no update policy — every row is created once, through a security-definer RPC, and never changes after. "Editing" a universe's schema is `publish_universe_version` appending version *n+1*; the story pinned to version *n* keeps reading it forever until its owner explicitly upgrades.

*Why:* a canon correction in a universe's schema must not retroactively change what a running story's entities look like. Retrofitting this after stories exist means every one of them breaks the first time someone edits a universe.

### Schema validation dispatches on field type, never on universe

`buildEntityDataValidator(entitySchema, entityType)` compiles a schema's field list into a Zod object validator with one `switch (field.type)` — over the eleven bounded primitives, never over a universe id, genre tag, or media type. The same function validates Ashfall Legion's `capability_list` fields and Wovenmere's `knowledge_set` fields with identical code.

*Enforced, not just documented:* `genre-agnosticism.test.ts` scans every engine source file for references to the fixture universes or genre-keyed dispatch patterns and fails if any engine file — other than the fixture file itself — contains one.

### Progression models follow the turn-mode dispatch pattern exactly

`resolveProgressionModel(slug)` mirrors `resolveTurnMode(mode)` structurally: a `Record<string, ProgressionModel>`, an unknown-slug error, and callers that resolve once and never branch on which model they got. `ability_unlock`'s transition graph (`proposed → developing → available → mastered|lost|sealed`) lives entirely inside its own table entry.

*Alternative rejected:* validating capability transitions inside `entities.ts` with an `if (universe === 'ashfall-legion')` check. This is exactly the shape of violation the project's core constraint exists to prevent, and the two proof fixtures exist specifically to catch it.

### Schema-validated writes are additive, not a migration every story takes

A story's `universe_id` is nullable and unbackfilled. Entity writes validate against a pinned schema only when one exists; a story with no universe keeps Phase 1's opaque-`jsonb` behavior forever, not as a transitional state but as a permanently valid one.

## Database objects

Created in Phase 2: `universes`, `universe_versions`. Added to `stories`: nullable `universe_id`, `universe_version` (composite FK into `universe_versions`).

New RPCs: `create_universe_with_version`, `publish_universe_version`, `upgrade_story_universe_version`; `create_story` extended with optional universe-pin parameters.

→ [Full data model](/reference/data-model)

## Verifying the phase

- `buildEntityDataValidator` and `resolveProgressionModel` unit-tested against every primitive type and both registered models independently
- Both fixture universes' real schemas and progression models run through the real validator and dispatch functions in `test-universes.test.ts` — not reimplementations of the logic, the actual functions
- `genre-agnosticism.test.ts` — structural guard against a genre/universe conditional leaking into engine code
- `entities.test.ts` — schema-validated writes accepted/rejected correctly; a story with no pinned universe remains fully unconstrained; capability transition enforcement wired end to end
- `npm test`, `npm run typecheck`, `npm run build` all pass from `apps/web`

## Working the phase

```bash
openspec show phase-2-universe-system
openspec status --change phase-2-universe-system
openspec validate phase-2-universe-system
```

→ [Spec workflow](/reference/spec-workflow)
