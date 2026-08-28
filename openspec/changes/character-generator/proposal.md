## Why

Creating a character today is a form you fill in by hand. For a story with no pinned universe that is two boxes (name, type) and an opaque `data` object nobody populates. For a story *with* a pinned universe it is `NewSchemaEntityForm`: one input per schema field, so a universe that defines `power_level`, `affinities`, `resolve`, and a `capability_list` asks the GM to type all of it, field by field, for every character.

That is backwards. The universe already declares, in machine-readable form, exactly what a character of a given type consists of — `entitySchema.entity_types[type].fields`, drawn from the eleven-primitive vocabulary in `lib/engine/schema.ts`. A model handed that field list, the Canon Bible, and a sentence of GM intent can fill it in. The GM should be describing a character, not transcribing one.

The `story-premise-generator` change establishes the interaction for this: guided open-ended fields plus a freeform pitch, a model drafts, a human keeps what they like and re-rolls what they do not. This change applies that same loop to character creation, at the smaller scale the surface deserves — the draft lands *in the existing form* rather than in its own reviewed document, because the form is already the review UI. Every field the model fills is an input the GM can edit before saving, and saving still goes through the unchanged `createSchemaEntityAction` path.

**Build-plan phase:** Phase 8 (Polish). Depends only on shipped work — the entity schema system and dynamic form (Phase 2), the AI gateway and role table (Phase 1), and the untrusted-input fencing used by every other prompt builder. It adds no engine capability: it is a creation-surface improvement that writes through the entity-creation path that already exists.

## What Changes

- **A "Generate" affordance on the character creation form.** The GM writes a freeform description of the character they want — a sentence or a paragraph — and the model returns a filled draft: a name plus a value for each field the type's schema defines. The values populate the form's inputs in place. Nothing is saved until the GM submits, exactly as today.

- **Generation is schema-driven, not genre-driven.** The prompt is built by walking the entity type's field list and describing each field by its *primitive type and constraints* — an `enum`'s permitted values, a `number`'s min/max, a `resource`'s max, the capability-status lifecycle for a `capability_list`. The model is told what shape to return for each primitive; it is never told what genre it is writing for, and no code path branches on universe, genre, or media type (constraint #1). The same builder produces a prompt for a power-scaling universe and a social-mystery universe. This is what makes "we do not need to manually input power levels" true without the engine ever learning what a power level is.

- **Output is validated against the pinned schema before it reaches the form.** The model returns `{ name, data }`; `data` is parsed through `buildEntityDataValidator(entitySchema, entityType)` — the same validator `createEntity` enforces on write (constraint #7). A field the model returns that fails validation is **dropped, not saved and not surfaced as a value**, leaving that input blank for the GM rather than putting an invalid value in front of them. A wholly malformed response retries once through `callStructured` and then raises a typed error the form renders as retryable.

- **A freeform section rides along on every character.** Two things the schema cannot express get their own always-present inputs: `description` (prose the GM writes or the model drafts) and a **freeform notes** box. Notes are the escape hatch the request asks for — anything the universe's schema has no field for, written in plain language. Both are stored in `data` under reserved keys, and **both are passed to the model as intent on a regenerate**, so a GM can write "make her a reluctant leader, terrified of the sea" in notes, regenerate, and have it reflected in the typed fields.

- **The freeform notes reach the AI at generation time, not just at rest.** This is the substance of keeping a freeform section and putting it through the model: notes are prompt input on every generate and regenerate, fenced as untrusted GM text through the existing `untrustedSections` helper.

- **Regenerate preserves what the GM has already touched.** The form tracks which inputs the GM edited by hand after a generate. On regenerate those values are passed into the prompt as fixed constraints and echoed back unchanged; only untouched fields are re-rolled. A GM never loses a name or a stat they liked to an unlucky second roll — the same pinning rule `story-premise-generator` applies per section, applied here per field.

- **A new `character` model role** joins the role table in `lib/ai/roles.ts` and `CONFIGURABLE_TEXT_ROLES`, defaulting to the same creative-tier model as `narrator`. The call declares the role, resolves its model from the story's `model_config` via the story's resolved API key, parses through Zod, and writes a `usage_log` row (constraints #6, #7, #8).

- **Stories with no pinned universe get the same affordance.** With no schema there are no typed fields to fill, so the model returns `name`, `description`, and a suggested `type`, and the freeform notes still ride along into opaque `data`. One code path, one prompt builder; the field list is simply empty. This keeps the unpinned (Phase 1) story from being a second-class creation surface.

- **Generation is never required.** The form works exactly as it does today if the GM ignores the Generate control and types everything. Nothing about the save path, the RPC, or the resulting entity differs between a generated character and a hand-typed one.

## Capabilities

### Added Capabilities
- `character-generation`: schema-driven character drafting — intent capture with a freeform section, prompt construction from the entity type's field list, schema-validated output, per-field pinning on regenerate, and population of the existing creation form.

### Modified Capabilities
- `entity-schema`: the "Dynamic entity form rendering" requirement gains scenarios for a schema-driven generated draft populating that form, and for an invalid generated field being dropped rather than rendered.
- `ai-gateway`: the role table gains `character`. Covered by the existing role-routing requirement — a new role entry and its default, no new gateway behavior.

## Non-goals

- **No genre, archetype, or class picker.** Intent is open text. Nothing in this change may enumerate genres or make behavior conditional on one.
- **No new table and no draft persistence.** A character draft lives in the form's client state until saved. It is one model call taking seconds, and the form is already the review surface — a `character_drafts` table would add a migration, RLS, and a cleanup story for state the GM either saves or discards within one sitting.
- **No portrait or image generation.** `illustrator` exists and is out of scope here; this change generates fields and prose only.
- **No multi-candidate generation.** One draft at a time, refined by regenerating with notes and pinned fields.
- **No bulk cast generation.** One character per call. Seeding a whole cast at story creation is `story-premise-generator`'s job, and it already creates cast entities through `createEntity`.
- **No editing generated characters through a special path after save.** Once saved it is an ordinary entity, edited through the entity edit form and `updateEntityField`, writing history rows like any other change.
- **No relaxation of schema validation.** The generator is a producer of candidate values, not an exemption from the validator. Anything it produces that the pinned schema rejects is discarded.

## Impact

- **Schema**: none. No migration.

- **New code**:
  - `lib/engine/character-generation.ts` (`server-only`) — `characterIntentSchema`, `generatedCharacterSchema`, `generateCharacter(args)`: resolves the pinned universe version (if any), builds the response schema from the entity type's field list, calls the `character` role through `callStructured`, validates `data` against `buildEntityDataValidator`, drops invalid fields, and returns `{ name, data, droppedFields }`.
  - `lib/ai/character-prompt.ts` — system prompt and `buildCharacterPrompt`: renders the field list as a typed contract (per-primitive shape, enum values, numeric bounds, capability statuses), renders pinned fields as fixed constraints, folds in the GM's description and freeform notes, and fences all GM text and Canon Bible context through `untrustedSections` / `withUntrustedPreamble`.
  - `app/stories/[storyId]/entities/generate-actions.ts` (`'use server'`) — `generateCharacterAction`: `requireUser()`, membership via the existing `getStory` path, rate-limit check, calls `generateCharacter`, returns a typed state carrying the draft or a retryable error.
  - `app/stories/[storyId]/entities/entity-fields/generate-character-panel.tsx` (`'use client'`) — the description + freeform-notes inputs and the Generate/Regenerate button.
  - Tests: `character-generation.test.ts` (valid draft passes through; an out-of-range `number` and a bad `enum` value are dropped while sibling fields survive; pinned fields are echoed unchanged; malformed output raises the typed error; a story with no pinned universe returns name/description/type), `character-prompt.test.ts` (every primitive renders its contract, enum values and numeric bounds appear, pinned fields render as constraints, GM notes are fenced as untrusted).

- **Modified code**:
  - `lib/ai/roles.ts` — add `character` to `MODEL_ROLES`, `DEFAULT_MODELS` (creative tier, matching `narrator`), and `CONFIGURABLE_TEXT_ROLES` so GMs can point it at a free model. `modelConfigSchema` derives from `MODEL_ROLES` and picks it up automatically; existing stories fall back through `resolveModel`.
  - `app/stories/[storyId]/entities/entity-fields/new-schema-entity-form.tsx` — hosts the generate panel; form inputs become controlled-on-generate so a draft can populate them, tracking per-field GM edits for pinning.
  - `app/stories/[storyId]/entities/new-entity-form.tsx` — same panel for the unpinned-universe story.
  - `lib/rate-limit.ts` — add a `character_generate` action. It is a paid model call driven by a button a GM can hold down, so it needs its own limit rather than sharing `turn_generate`.
  - `lib/engine/schema.ts` — export a small `describeField(field)` helper so prompt construction has the per-primitive contract in one place; no change to the vocabulary or the validator.

- **Cost**: one `character`-role call per generate or regenerate, billed to the story's resolved key (GM → owner → platform) and recorded in `usage_log` under the story, so it appears in the existing per-story cost view.

- **Failure behavior**: a transport failure or a post-retry `StructuredOutputError` leaves the form exactly as the GM left it — typed intent, notes, and any pinned values are never cleared — and surfaces a retryable message. Partial validity is not a failure: valid fields populate, invalid ones stay blank, and the GM is told which fields the model could not fill acceptably.

- **Docs**: `docs/docs/architecture/` gains a character-generation page covering the schema-to-prompt construction and the pinning rule; the model-roles reference gains the `character` row.
