---
sidebar_position: 4
title: Schema System
---

# Schema System

:::info Implemented in Phase 2
Entity Schema storage, validation, and dynamic form rendering shipped in [Phase 2](/phases/phase-2-universe-system). Universes are hand-authored in this phase — automatic derivation from research is [Phase 3](/phases/build-order#phase-3--research-pipeline).
:::

The schema system is how one engine runs every genre. A universe declares what an entity *is* in its own vocabulary, and the engine renders forms, validates state, and targets extraction from that declaration.

## Entity schema

```json
{
  "entity_types": {
    "character": {
      "label": "Character",
      "fields": [
        {"key": "name", "type": "string", "required": true},
        {"key": "description", "type": "text"},
        {"key": "cursed_technique", "type": "string", "label": "Cursed Technique"},
        {"key": "grade", "type": "enum",
         "values": ["Grade 4", "Grade 3", "Grade 2", "Grade 1", "Special Grade"]},
        {"key": "abilities", "type": "capability_list"},
        {"key": "cursed_energy", "type": "resource", "max": 100},
        {"key": "status", "type": "enum",
         "values": ["healthy", "injured", "critical", "incapacitated", "dead"]},
        {"key": "relationships", "type": "relationship_map"}
      ]
    },
    "faction": { "fields": [] },
    "location": { "fields": [] }
  }
}
```

Note what the engine sees here: `cursed_technique` is just a `string`, and `grade` is just an `enum`. The engine has no idea what a cursed technique is, and that is the point.

:::tip The schema is derived from research, not chosen from a menu
Stage 6 of the [research pipeline](/phases/build-order#phase-3--research-pipeline) proposes the schema based on what the universe actually is. A shonen universe gets `abilities[]`, `power_tier`, `drawbacks`. A mystery gets `knows[]`, `suspicion_level`, `alibi`. A political drama gets `faction_standing{}`, `secrets[]`, `leverage[]`.
:::

## Field types

These primitives are the **entire** engine vocabulary. Universes compose them; the engine never adds a domain-specific type.

| Type | Renders as | Extracted by | Used for |
|---|---|---|---|
| `string`, `text` | input / textarea | free text diff | names, descriptions |
| `enum` | select | value change | status, tier, rank |
| `number` | input | numeric diff | levels, counts, resources |
| `resource` | gauge | current/max diff | mana, stamina, ammo |
| `capability_list` | list editor | add/remove/status-change | powers, skills, spells, techniques |
| `relationship_map` | matrix editor | edge weight diff | trust, rivalry, affection |
| `knowledge_set` | tag list | fact added/removed | who knows what (mystery) |
| `standing_map` | matrix | reputation delta | faction politics |
| `tag_list` | chips | add/remove | traits, conditions, flags |
| `reference` | entity picker | link change | location, allegiance |

Adding a genre-specific type is a design failure. If a universe seems to need one, the correct response is to find which primitive it decomposes into.

Field-value validation dispatches on `field.type` alone (`buildEntityDataValidator` in `apps/web/src/lib/engine/schema.ts`) — an object of the eleven primitives above, compiled into a Zod validator at request time. The same function validates every universe; nothing in it, or anywhere it's called from, checks which universe it's validating.

## The capability object

The most important composite type, used by any universe with progression. Phase 2 implements the lifecycle status; `cost`, `limits`, `unlocked_at_chapter`, and `gatekeeper_ruling` are future fields the [Gatekeeper](/architecture/validation-gatekeeping) will populate in Phase 6.

```json
{
  "id": "uuid",
  "name": "Hollow Purple",
  "status": "proposed|developing|available|mastered|lost|sealed"
}
```

The `status` field is what will make [capability gating](/architecture/validation-gatekeeping) possible in Phase 6: a character using a capability marked `proposed` or `developing` will be a blocking violation. In Phase 2, the `ability_unlock` progression model already enforces the lifecycle's legal transitions (see below) — the Gatekeeper adds a second, semantic layer of enforcement on top later.

## Progression models

Shipped as plugins, resolved through a dispatch table (`apps/web/src/lib/engine/progression-models.ts`) that mirrors the [turn-mode dispatch table](/architecture/turn-loop) exactly: callers resolve a model once by its slug and use what comes back, with no branch on which one they got.

Phase 2 registers exactly two, per the [build order](/phases/build-order#phase-2--universe-system):

| Model | Tracks | Status |
|---|---|---|
| `none` | Nothing — entities change only by direct edit or extraction | Implemented, Phase 2 |
| `ability_unlock` | `capability_list` items through `proposed → developing → available → mastered\|lost\|sealed`; other field types pass through unchecked | Implemented, Phase 2 |

Future models (not yet implemented) that Part 4 of the build plan anticipates, added the same way — a new dispatch-table entry, no change to any caller:

| Model | Tracks | Gatekeeper asks (Phase 6+) |
|---|---|---|
| `numeric_scaling` | Single power value | "Is this jump proportionate to what happened?" |
| `skill_tree` | Levels, stats, branches | "Do they have the prerequisites and the points?" |
| `resource_cost` | Consumable pools | "Can they afford this? What is depleted?" |
| `knowledge_state` | Facts known per entity | "Could they know this? Who told them?" |
| `relationship_web` | Weighted edges | "Is this shift earned by what has happened between them?" |
| `reputation` | Standing per faction | "Does this action plausibly move standing this much?" |

:::danger Design constraint
Adding a new progression model must require **zero** changes to the turn loop or to any caller of `resolveProgressionModel`. A model registers only what its own hooks need — Phase 2's two need just a transition-validation function.
:::

## Universe versioning

Universes are versioned; forking arrives with the marketplace in Phase 8. Editing a universe inserts a new immutable `universe_versions` row rather than mutating the published one; a story pins to a specific `(universe_id, universe_version)` and upgrades only through an explicit owner action.

This exists so that a canon correction in chapter 41 cannot retroactively invalidate chapters 1–40. It shipped in Phase 2 — retrofitting it later would mean every existing story breaks the first time someone edits a universe. See [Universe Versioning](/architecture/universe-versioning).

## The proof

Phase 2's exit criterion is exactly this: two structurally incompatible universes run through the identical engine code, with no genre-specific branch anywhere in it.

The two fixtures (`apps/web/src/lib/engine/test-universes.ts`) prove it mechanically:

1. **Ashfall Legion** — power-scaling superhero, `ability_unlock`, `capability_list` + `resource` + `number` fields
2. **Wovenmere** — cozy social mystery, `none`, `knowledge_set` + `relationship_map` fields, zero combat vocabulary

Both validate through the same `buildEntityDataValidator` call and resolve their progression model through the same `resolveProgressionModel` call — see `genre-agnosticism.test.ts`, which scans engine source for any reference to a specific universe or genre-keyed branch and fails the build if one appears.

The three [launch templates](/phases/build-order#phase-3--research-pipeline) (Shonen Action, Locked-Room Mystery, Court Intrigue) are the same proof at full scale, once research-derived schemas exist in Phase 3.
