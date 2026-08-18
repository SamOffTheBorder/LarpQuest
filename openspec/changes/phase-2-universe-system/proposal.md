## Why

Phase 1 proved the generic core: entities are opaque `{name, description, data: jsonb}` blobs and progression exists nowhere. That is intentionally unstructured — it was never meant to support real universes. Phase 2 (Build Plan Part 10) gives universes a way to declare *what an entity is* (Part 3, Schema System) and *how entities change over time* (Part 4, Progression Models), without the engine ever knowing what a "power" or a "faction standing" is. This is the load-bearing abstraction the rest of the plan depends on: Phase 3's research pipeline derives schemas from research, Phase 6's Gatekeeper validates against them, and neither can be designed against a moving target.

## What Changes

- Add a **Universe** entity: a named, versioned container for an Entity Schema and a chosen Progression Model, independent of any story. Stories reference a universe at a pinned version (Part 2.4, Part 11.1).
- Add **Entity Schema** storage: per-universe-version definition of entity types, each with a list of typed fields drawn from the Part 3.2 primitive vocabulary (`string`, `text`, `enum`, `number`, `resource`, `capability_list`, `relationship_map`, `knowledge_set`, `standing_map`, `tag_list`, `reference`). Schemas are data, never code.
- Add **dynamic form rendering**: a form generator that reads a schema's field list and renders the corresponding input for each primitive type. No form component may be genre- or universe-specific.
- Add a **progression model plugin architecture**: a dispatch table (mirroring `turn-modes.ts`) keyed by a `progression_model` slug on the universe. Phase 2 registers exactly two: `none` (no progression semantics — entities are edited manually or by extraction, same as Phase 1) and `ability_unlock` (entities carry a `capability_list` field whose items move through the Part 3.3 status lifecycle: `proposed → developing → available → mastered/lost/sealed`).
- Add **universe versioning**: editing a universe's schema creates a new immutable version; existing stories keep their pinned version until the owner explicitly upgrades. No in-place mutation of a published version.
- Extend entity validation: once a story has a pinned universe with a schema, entity `data` is validated against that schema's field types on write. A story with no universe (or a universe using `none`-typed free fields) keeps Phase 1's unconstrained behavior — this is a widening, not a breaking change to `entity-state`.
- Seed the two Part 12 launch fixtures needed to prove the exit criterion structurally: one universe using `ability_unlock` (powers), one using `none` (no powers), both exercised through the identical turn loop and entity code with zero added conditionals.

## Non-goals

- No research pipeline. Universes and schemas are authored manually (by a developer/seed script or a future admin UI) in this phase — Stage 1–8 automated derivation is Phase 3.
- No Gatekeeper or validation rule engine. Schema field *types* are enforced; semantic rules ("you can't unlock a power you haven't earned") are Phase 6.
- No `numeric_scaling` or any progression model beyond `ability_unlock` and `none` — Part 10 caps Phase 2 at exactly two.
- No universe marketplace, forking, or public browsing (Phase 8).
- No changes to turn modes, validation, memory/context assembly beyond passing schema-typed data through unchanged, or multiplayer.
- No UI for authoring schemas visually — dynamic *rendering* of entity forms from a schema is in scope; a schema *editor* is not required to hit the exit criterion.

## Capabilities

### New Capabilities
- `entity-schema`: Schema definition storage (entity types, typed fields from the Part 3.2 primitive set), per-universe-version, and validation of entity `data` writes against the pinned schema.
- `universe-versioning`: Universe as a first-class, versioned, forkable-in-the-future record; stories pin a specific version; editing creates a new version rather than mutating the pinned one.
- `progression-models`: Dispatch-table plugin architecture for progression semantics, registering `none` and `ability_unlock` in this phase, with the `capability_list` status lifecycle for the latter.

### Modified Capabilities
- `entity-state`: entity `data` writes gain schema-typed validation when the owning story has a pinned universe version; the existing schemaless path remains the default for stories without one, so no existing requirement is removed, only extended.
- `story-lifecycle`: a story gains an optional pinned `universe_id` + `universe_version`, established at creation and changeable only via explicit, deliberate upgrade (not silent follow-latest).

## Impact

- New tables: `universes`, `universe_versions` (versioned schema + progression model config), `entity_schemas` (or embedded in `universe_versions`, TBD in design). Migration files with RLS gated through `story_members` (universes are visible to any member of a story that pins them; authoring is owner-scoped).
- `apps/web/src/lib/engine/`: new `schema.ts` (schema types + Zod-based validator), new `progression-models.ts` (dispatch table, mirrors `turn-modes.ts`), changes to `entities.ts` (validate against pinned schema before write).
- `apps/web/src/lib/engine/test-universes.ts`: extend or replace fixtures to carry an explicit universe/schema/progression-model reference so the exit criterion ("two structurally different universes... run on the same code with no genre conditionals") is mechanically testable.
- New UI: dynamic entity form renderer under `apps/web/src/app` reading a schema; no new page flows required beyond what's needed to exercise it.
- Docs: `docs/docs/architecture/` gains a schema-system / progression-models page; `docs/docs/phases/` gains `phase-2-universe-system.md`; sidebar updated.
