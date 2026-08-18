## 1. Database: universes and versions

- [x] 1.1 Migration `supabase/migrations/20260817000001_universes.sql`: create `universes` (id, owner_id, name, created_at) and `universe_versions` (id, universe_id, version int, entity_schema jsonb, progression_model text, progression_config jsonb default '{}', published_at, created_at), unique constraint on `(universe_id, version)`.
- [x] 1.2 Same migration: enable RLS on both tables. `universes`: select for owner or any story member of a story pinning it (via subquery on `stories`); insert/update/delete owner-only. `universe_versions`: select follows parent `universes` visibility; no direct update/delete policy (immutability — enforced by absence of policy, matching `entity_history`'s pattern); insert via RPC only (task 1.4).
- [x] 1.3 Same migration: add nullable `stories.universe_id uuid references universes(id)` and `stories.universe_version int`, plus a composite FK `(universe_id, universe_version) references universe_versions(universe_id, version)`. Both null by default — no backfill.
- [x] 1.4 Migration `supabase/migrations/20260817000002_universe_version_operations.sql`: `create_universe_with_version(p_owner_id, p_name, p_entity_schema, p_progression_model, p_progression_config)` RPC inserting a `universes` row and its version-1 `universe_versions` row in one transaction (security definer, pinned search_path, matching `create_entity_with_history`'s pattern). `publish_universe_version(p_universe_id, p_entity_schema, p_progression_model, p_progression_config)` RPC that reads the current max version, inserts version+1, verifying caller owns the universe.
- [x] 1.5 Run `supabase db push` against the linked project, then `supabase db advisors --linked` and the RLS coverage test file; fix any flagged gaps before continuing.

## 2. Engine: schema vocabulary and validator

- [x] 2.1 `apps/web/src/lib/engine/schema.ts`: Zod schema for `entity_schema` jsonb shape — `entity_types: Record<string, { label, fields: Field[] }>`, `Field` as a discriminated union over the eleven Part 3.2 primitives (`string`, `text`, `enum`, `number`, `resource`, `capability_list`, `relationship_map`, `knowledge_set`, `standing_map`, `tag_list`, `reference`), each with its type-specific options (e.g. `enum.values`, `resource.max`).
- [x] 2.2 Same file: `buildEntityDataValidator(entitySchema, entityType): ZodType` compiling a schema's field list into a Zod object validator, dispatching per-field on `field.type` only.
- [x] 2.3 `apps/web/src/lib/engine/schema.test.ts`: unit tests — schema with all eleven primitives accepted; unknown type rejected; validator accepts matching data; validator rejects a wrong-typed value per primitive; validator ignores fields absent from the schema (matches Phase 1's opaque-extra-fields behavior) — confirm intended behavior before asserting it.

## 3. Engine: universe & version persistence

- [x] 3.1 `apps/web/src/lib/engine/universes.ts`: `createUniverse`, `getUniverse`, `getUniverseVersion(universeId, version)`, `publishUniverseVersion`, each parsing input through the Zod schema from 2.1 before calling the RPCs from 1.4. Follow `entities.ts`'s pattern: membership/ownership check first, `toJson` for jsonb params, typed errors on RPC failure.
- [x] 3.2 `apps/web/src/lib/engine/universes.test.ts`: create universe + version 1; publish version 2 and confirm version 1 row is unchanged; attempt to name an unregistered `progression_model` and confirm rejection (depends on 4.1 dispatch table existing).

## 4. Engine: progression model dispatch table

- [x] 4.1 `apps/web/src/lib/engine/progression-models.ts`: `ProgressionModel` interface (`name`, optional `validateTransition(field, from, to): boolean`), `PROGRESSION_MODELS` record, `resolveProgressionModel(slug)` throwing `UnknownProgressionModelError` — mirror `turn-modes.ts` structure exactly, including its doc comment explaining the dispatch-table discipline.
- [x] 4.2 Register `none`: no `validateTransition` (always allowed).
- [x] 4.3 Register `ability_unlock`: `validateTransition` enforcing `proposed → developing → available → mastered|lost|sealed` for `capability_list` item status changes only; other field types pass through unchecked by this model.
- [x] 4.4 `apps/web/src/lib/engine/progression-models.test.ts`: valid transition sequence accepted; skipping a state rejected; terminal states reject any further transition; `none` model allows an arbitrary transition; unregistered slug throws.

## 5. Engine: wire schema validation and progression into entity writes

- [x] 5.1 Extend `apps/web/src/lib/engine/entities.ts`: `createEntity` and `updateEntityField` load the story's pinned universe version (if any) and, when present, validate `data`/the updated field with `buildEntityDataValidator` before calling the existing RPCs. No pinned version → unchanged Phase 1 path.
- [x] 5.2 Same file: when the field being updated is a `capability_list` item status change and the universe version's `progression_model` has a `validateTransition`, call it and reject the write on `false` before persisting.
- [x] 5.3 `apps/web/src/lib/engine/entities.test.ts` additions: entity write validated against a pinned schema (accept + reject cases); entity write in a story with no pinned universe remains unconstrained; capability status transition enforcement wired end-to-end for an `ability_unlock` story.

## 6. Fixtures: prove the exit criterion

- [x] 6.1 Update `apps/web/src/lib/engine/test-universes.ts`: give `ASHFALL_LEGION` an explicit `entity_schema` (character type with `powerLevel: number`, `abilities: capability_list`, `status: enum`, `location: reference`) and `progression_model: 'ability_unlock'`; give `WOVENMERE` an explicit `entity_schema` (character type with `knowledge: knowledge_set`, `relationships: relationship_map`, `status: enum`) and `progression_model: 'none'`.
- [x] 6.2 `apps/web/src/lib/engine/test-universes.test.ts` (extend existing): both fixtures' real `entitySchema`/`progressionModel` validated through `entitySchemaSchema`, `buildEntityDataValidator`, and `resolveProgressionModel` — the real functions, not reimplementations — proving structurally incompatible universes pass through identical code. (Full turn-loop wiring for a pinned universe is exercised at the entities.ts layer in task 5.3; a redundant end-to-end turn harness was judged not to add coverage beyond what turns.test.ts and entities.test.ts already prove.)
- [x] 6.3 `apps/web/src/lib/engine/genre-agnosticism.test.ts`: scans every non-test engine file for fixture names and genre-keyed dispatch patterns; fails if any engine file (other than the fixture file itself) names a specific universe or branches on genre/media-type vocabulary.

## 7. UI: dynamic entity form rendering

- [x] 7.1 `apps/web/src/app/stories/[storyId]/entities/entity-fields/field-renderer.tsx`: `EntityFieldRenderer` renders one control per primitive (native inputs for `string`/`text`/`enum`/`number`/`resource`/`reference`; a JSON textarea for the four structured composites — `capability_list`, `relationship_map`, `knowledge_set`, `standing_map`, `tag_list` — since none has a natural single-line control and a rich list/matrix editor per composite is a larger feature better scoped once real usage shows what's needed).
- [x] 7.2 Same file: dispatch is a `switch (field.type)` — the same bounded vocabulary `buildEntityDataValidator` dispatches on, never a universe/genre check.
- [x] 7.3 `entity-schema-form.tsx` (`EntitySchemaForm`) walks `entity_schema.entity_types[type].fields`, renders `EntityFieldRenderer` per field; `parse-form-data.ts` (`parseEntityFormData`) is the inverse, reassembling `data` server-side from the submitted `FormData` using the same field list; `actions.ts` gained `createSchemaEntityAction`/`updateSchemaEntityAction` calling `createEntity`/`updateEntityField`.
- [x] 7.4 Wired into `entities/page.tsx` (one `NewSchemaEntityForm` per entity type) and `entities/[entityId]/page.tsx` (`EditSchemaEntityForm`): both read the story's pinned universe version and use the schema form when present, falling back to Phase 1's freeform `NewEntityForm`/`EditFieldForm` when `universeId` is null.
- [x] 7.5 Verified via `npm run build` (compiles and type-checks all new routes/components) and the existing schema/progression unit tests, which exercise the exact validator and field-type dispatch these forms are built on for both fixture universes. A live browser click-through was not performed — it requires a signed-in session (magic-link email) that can't be driven non-interactively in this environment; the user opted to rely on build+typecheck+tests instead of a manual session.

## 8. Story creation: universe selection

- [x] 8.1 Extend the story creation flow/API to accept an optional `universeId`; on creation, resolve the universe's latest published version and set `universe_id`/`universe_version` per design decision 1 (created-already-published, no draft state this phase).
- [x] 8.2 Extend `apps/web/src/lib/engine/stories.ts` (or wherever story creation lives) tests: story created with a universe gets the correct pinned version; story created without one has null universe fields; explicit upgrade path sets a new pinned version without touching entity_history.
- [x] 8.3 Add an explicit "upgrade universe version" action (server action or API route) separate from creation — never implicit/automatic. (`upgradeStoryUniverseVersion` in stories.ts + `upgrade_story_universe_version` RPC; no UI action wired to it yet since there is no universe-authoring UI this phase — the function is the deliverable, matching entity-schema's non-goal of no schema-editor UI.)

## 9. Docs (Docusaurus)

- [x] 9.1 `docs/docs/phases/phase-2-universe-system.md`: mirrors `phase-1-generic-core.md`'s structure — scope, exit criteria, what shipped/didn't, key design decisions, database objects, verification, links to the relevant architecture docs.
- [x] 9.2 `docs/docs/architecture/schema-system.md`: this page already existed as a forward-looking Phase-1-era design doc; updated in place to mark what's implemented now vs. still future (progression models table split into "Phase 2, implemented" vs. "anticipated by Part 4, not yet built"; capability object trimmed to its Phase 2 fields; the proof section now points at the real fixtures and `genre-agnosticism.test.ts` instead of the future three-template proof).
- [x] 9.3 Folded into `schema-system.md`'s existing "Progression models" section rather than a separate file — the page already covered this ground for the forward-looking design; splitting it out would have duplicated the field-type vocabulary context. Same content the task called for (dispatch-table pattern, `none`/`ability_unlock`, capability lifecycle) lives there now, updated to reflect what's actually implemented.
- [x] 9.4 `docs/docs/architecture/universe-versioning.md`: new page — immutable versions, the two RPCs that are the only write path, story pinning, explicit-upgrade-only, Part 11.1 rationale.
- [x] 9.5 `docs/sidebars.ts` updated: added `architecture/universe-versioning` and `phases/phase-2-universe-system`.
- [x] 9.6 `docs/docs/phases/build-order.md`: Phase 2 row now links to its page; section marked "Status: implemented" with a link to the full spec.
- [x] 9.7 `npm run build` inside `docs/` — clean, no broken links. Also updated `docs/docs/reference/data-model.md` (split the aspirational future `universes` table from what Phase 2 actually created, since it was previously drawn as the full Phase 3+6+8 shape) and `docs/docs/architecture/layers.md`'s phase-availability table.

## 10. Verification

- [x] 10.1 From `apps/web`: `npm test` (146/146 passing), `npm run typecheck` (clean), `npm run build` (compiles, all routes generated) — all three pass. `docs/` `npm run build` also verified clean separately (task 9.7).
- [x] 10.2 `openspec validate phase-2-universe-system --strict` passes.
- [x] 10.3 Part 12/Part 10 exit criterion confirmed at the code level: both fixture universes' real schemas and progression models pass through `buildEntityDataValidator`/`resolveProgressionModel` identically (`test-universes.test.ts`), entity writes are schema-validated end-to-end for a pinned `ability_unlock` story while an unpinned story stays fully unconstrained (`entities.test.ts`), and `genre-agnosticism.test.ts` structurally guards against a genre/universe conditional appearing anywhere in engine code. A live multi-turn run through the UI was not performed non-interactively (see task 7.5's note) — the exit criterion's substance (schema + progression dispatch working identically for structurally incompatible universes) is verified at the function level instead, which is what the turn loop itself calls.
