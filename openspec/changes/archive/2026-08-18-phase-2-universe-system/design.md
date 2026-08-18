## Context

Phase 1 shipped entities as `{type, name, data: jsonb}` with zero interpretation of `data` (`apps/web/src/lib/engine/entities.ts`), and a single-entry turn-mode dispatch table (`apps/web/src/lib/engine/turn-modes.ts`) as the reference pattern for "add behavior without adding conditionals." Phase 2 must generalize both: give universes a way to declare entity shape (Part 3) and give the engine a way to run type-specific progression semantics (Part 4) — using the same dispatch-table discipline, not a parallel one.

Two Part 12 fixtures already exist for exactly this purpose (`test-universes.ts`): Ashfall Legion (power-scaling superhero) and Wovenmere (cozy mystery, no combat). They currently carry unstructured `data` with no schema reference. Phase 2 must attach real schemas and progression models to them and prove both run through identical code.

No research pipeline exists yet (Phase 3), so schemas are hand-authored in this phase — by a seed script now, by a future admin/import UI later. The storage and validation design must not assume research-derived provenance (confidence scores, citations, etc. — those are Phase 3 additions to the same tables/versions, not a reason to redesign them later).

## Goals / Non-Goals

**Goals:**
- Universe + versioned schema storage that a story pins to, per Part 2.4 / Part 11.1.
- A field-type vocabulary limited to the Part 3.2 primitive list, enforced by a Zod-based validator generated from the schema — no per-universe code.
- A progression-model dispatch table mirroring `turn-modes.ts` exactly in shape and philosophy, registering `none` and `ability_unlock`.
- Dynamic entity form rendering driven entirely by schema field type, with one renderer component per primitive.
- Prove the exit criterion mechanically: both fixture universes pass through the same `createEntity`/`updateEntityField`/context-assembly code paths with zero new conditionals in engine code.

**Non-Goals:**
- Schema authoring UI (visual editor). Seed scripts and direct inserts are sufficient for this phase.
- Any semantic/business-rule validation (Gatekeeper, Phase 6). This phase validates *shape* (a `resource` field is a `{current, max}` pair; an `enum` field's value is in the allowed set), never *legality* (whether a value transition should be allowed).
- Automatic schema derivation from research (Phase 3).
- Universe forking/cloning/marketplace (Phase 8).

## Decisions

**1. Universe and schema are separate tables from `stories`, with an explicit pin.**
`universes` holds identity (name, owner). `universe_versions` holds one immutable snapshot per version: `entity_schema jsonb`, `progression_model text`, `progression_config jsonb`, `version int`, `published_at`. `stories` gains nullable `universe_id uuid` + `universe_version int` (a composite reference, not a foreign key to a single mutable row, since versions aren't individually keyed rows you'd FK to in isolation — implemented as a FK to `universe_versions(universe_id, version)` with a matching unique constraint). A story created with no universe keeps Phase 1 behavior exactly — this is additive, not a migration of existing stories.

*Alternative considered:* store the schema directly on `stories` (denormalized, no separate universe concept). Rejected — Part 2.4 requires universes to be independently versioned and (eventually, Phase 8) shared/forked across stories; coupling schema to story from the start means a second migration later to split them out.

**2. Versions are immutable; "editing" a universe inserts a new `universe_versions` row.**
No `update` policy on `universe_versions` beyond system-managed fields. The publish flow is: mutate a draft (kept as the highest unpublished version, or a separate `draft` table — see Open Questions), then insert a new immutable version row. Stories keep their pinned `(universe_id, universe_version)` until an explicit owner action changes it. This directly implements Part 11.1 ("editing canon mid-story must not retroactively break 40 chapters").

**3. Field types are a closed, engine-defined enum; schema is data, not code.**
`entity_schema` jsonb shape:
```json
{
  "entity_types": {
    "<type-key>": {
      "label": "string",
      "fields": [
        { "key": "string", "type": "<primitive>", "label": "string?", "required": "bool?", ...type-specific options }
      ]
    }
  }
}
```
Validated on write into `universe_versions` by a Zod schema (`apps/web/src/lib/engine/schema.ts`) enumerating exactly the Part 3.2 primitives (`string`, `text`, `enum`, `number`, `resource`, `capability_list`, `relationship_map`, `knowledge_set`, `standing_map`, `tag_list`, `reference`). Adding a twelfth primitive is a change to this one file; adding a new universe is never a code change.

**4. Entity `data` validation is schema-driven at the value layer, dispatched by field type — not by universe.**
`buildEntityDataValidator(entitySchema, entityType): ZodType` compiles a schema's field list into a Zod object at request time. `entities.ts` calls this only when the story has a pinned universe version; the function itself contains one dispatch (`switch` over field `type`, i.e. the primitive vocabulary — not over genre/universe/media type, which is the actual constraint CLAUDE.md prohibits). This mirrors `resolveTurnMode`: a bounded, engine-owned vocabulary, not an open branch on content.

**5. Progression models follow the exact `turn-modes.ts` pattern.**
`progression-models.ts` exports `ProgressionModel { name, onCapabilityStatusChange?(...), validateTransition?(...) }` and a `PROGRESSION_MODELS: Record<string, ProgressionModel>` table. `none` is a no-op (identity functions / undefined hooks). `ability_unlock` implements the Part 3.3 capability status lifecycle (`proposed → developing → available → mastered|lost|sealed`) as an allowed-transitions graph, applied only to fields of type `capability_list`. The turn/extraction pipeline calls `resolveProgressionModel(universeVersion.progressionModel)` the same way it calls `resolveTurnMode` — new entry in the table, zero change to callers.

**6. Dynamic forms: one component per primitive, keyed by type, composed by a schema-walking container.**
`EntityFieldRenderer` switches on `field.type` (again, bounded primitive dispatch) and delegates to `StringField`, `EnumField`, `ResourceField`, `CapabilityListField`, etc. The container walks `entity_schema.entity_types[type].fields` and renders each — it never imports or references a specific universe.

**7. RLS.**
`universes`: select for anyone who is a member of a story pinning any version of it, or the owner; insert/update(version rows only)/delete owner-only. `universe_versions`: select follows the same rule as its parent `universes` row; insert owner-only via a function that verifies ownership (mirrors `create_entity_with_history`-style RPC, since "insert a new immutable version" is a system operation, not a raw table write). Both gated ultimately through `story_members` for the story-facing read path (a member can read the schema their story is pinned to), plus direct owner checks for the authoring path (a universe with no stories yet still needs to be readable/writable by its owner).

## Risks / Trade-offs

- **Schema validation could tempt genre-specific special-casing under pressure** (e.g. "capability_list needs different validation for combat vs. non-combat universes"). Mitigation: `ability_unlock`'s transition graph lives in `progression-models.ts` keyed by *progression model*, never by universe or genre; the two fixtures (Ashfall Legion using `ability_unlock`, Wovenmere using `none`) are the standing regression test that this boundary holds — task list includes running both through one integration test.
- **Widening `entity-state`'s validation is a behavior change for existing (Phase 1) stories with no universe.** Mitigation: validation is opt-in per story via `universe_id IS NOT NULL`; a null universe is a documented, permanent, valid state (freeform/schemaless), not a migration path every story must eventually take.
- **Composite FK `(universe_id, universe_version) → universe_versions(universe_id, version)`** is less common than a single-column FK and needs a unique constraint on `universe_versions(universe_id, version)`. Mitigation: standard Postgres composite FK; covered by a migration test.
- **Draft-vs-published state for a universe under construction** is undefined by Part 2 in the no-research-pipeline case. Resolved under Open Questions below to avoid over-building a draft workflow Phase 3 will redesign anyway.

## Migration Plan

- New migration(s) additive only: `universes`, `universe_versions`, `stories.universe_id`/`universe_version` (nullable columns, no backfill needed — existing/new schemaless stories are unaffected).
- No changes to Phase 1 tables' constraints or existing RLS policies; only new tables and two new nullable columns + an FK on `stories`.
- Rollback: drop the new tables and columns; Phase 1 behavior is fully intact since nothing existing depends on the new columns being non-null.
- After migration: run `supabase db advisors --linked` and the RLS coverage test file per CLAUDE.md before trusting policies.

## Open Questions

- Draft workflow for an unpublished universe version: simplest option for this phase is "the first version is created already published, in one step" (no separate draft table), since Phase 2 has no human-review UI yet (that's Phase 3's job). Leaning toward this to avoid building review-state machinery that Phase 3 will likely replace. Confirm before writing tasks.
- Where exactly `entity_schema` and `progression_model`/`progression_config` live: one `universe_versions` row with both columns (current assumption above) vs. splitting `entity_schemas` into its own table as the proposal's Impact section hedged. Leaning toward one row — a version *is* the (schema, progression model) pair, and Part 2.4 versions the whole bundle together, not schema and progression independently.
