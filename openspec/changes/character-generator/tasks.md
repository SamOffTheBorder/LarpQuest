## 1. Role table

- [ ] 1.1 `apps/web/src/lib/ai/roles.ts`: add `character` to `MODEL_ROLES`, to `DEFAULT_MODELS` (`anthropic/claude-sonnet-4.5`, matching `narrator` — drafting a character is creative work), and to `CONFIGURABLE_TEXT_ROLES` so a GM can point it at a free model. `modelConfigSchema` derives from `MODEL_ROLES`, so no schema edit is needed.
- [ ] 1.2 `apps/web/src/lib/ai/roles.test.ts`: the new role resolves to its default when absent from `model_config`, and an explicit override wins.

## 2. Field description helper

- [ ] 2.1 `apps/web/src/lib/engine/schema.ts`: export `describeField(field: Field): string` — one line per field stating its key, label, and the shape a value must take, dispatching on `field.type` only via the same exhaustive switch the validator uses. `enum` lists permitted values; `number` states min/max when set; `resource` states its max and the `{current, max}` shape; `capability_list` states the item shape and the permitted `CAPABILITY_STATUSES`; `relationship_map`/`knowledge_set`/`standing_map`/`tag_list` state their JSON shapes; `reference` states it takes an entity id of the given type. No universe, genre, or media type is named.
- [ ] 2.2 `apps/web/src/lib/engine/schema.test.ts`: every one of the eleven primitives produces a description, enum values and numeric bounds appear in the output, and the switch is exhaustive (adding a primitive without handling it fails typecheck).

## 3. Prompt construction

- [ ] 3.1 `apps/web/src/lib/ai/character-prompt.ts`: `CHARACTER_SYSTEM_PROMPT` via `withUntrustedPreamble` — instruct the model that it drafts one character, returns JSON only matching the given contract, must respect every stated constraint, and must not invent fields outside the contract.
- [ ] 3.2 Same file: `buildCharacterPrompt(args: { entityTypeLabel, fields, description, notes, pinned, canonBible })` — renders the field contract from `describeField`, the pinned fields as fixed values to preserve verbatim, and the GM's description/notes and any Canon Bible context fenced through `untrustedSections`. Trusted scaffolding (the field contract) is passed as `trusted`; all GM and canon text as `untrusted`.
- [ ] 3.3 `apps/web/src/lib/ai/character-prompt.test.ts`: each primitive's contract line appears; enum values and numeric bounds appear; pinned fields render as fixed constraints; GM notes and description are fenced; an empty field list (unpinned story) still produces a valid prompt asking for name/description/type.

## 4. Generation module

- [ ] 4.1 `apps/web/src/lib/engine/character-generation.ts` (`server-only`): `characterIntentSchema` (`description` freeform text, `notes` freeform text, both optional but at least one non-empty; `pinned` record of field key to value; `entityType`). Reserved data keys `description` and `notes` defined here as constants so the form, the action, and `createEntity` agree on them.
- [ ] 4.2 Same file: `generateCharacter(args)` — resolve the story's pinned universe version (reusing the existing pinned-version lookup path in `entities.ts`; extract it to a shared helper rather than duplicating the query), take `entitySchema.entity_types[entityType].fields` (empty when unpinned), build the response Zod schema as `{ name: string, description: string, type?: string, data: record }`, call `callStructured` with role `character`, the story's `model_config`, and the key from `resolveStoryApiKey(storyId)`.
- [ ] 4.3 Same file: post-validation — for each returned `data` key that matches a schema field, validate that single field's value through the validator built from the pinned schema; drop failures. Echo pinned values back unchanged, overriding anything the model returned for those keys. Return `{ name, description, data, droppedFields }`.
- [ ] 4.4 Same file: wrap `StructuredOutputError` in a typed `CharacterGenerationError` the action can render as retryable, matching how `validator-call.ts` wraps its own.
- [ ] 4.5 `apps/web/src/lib/engine/character-generation.test.ts`: valid draft passes through intact; an out-of-range `number` and an invalid `enum` value are dropped while valid siblings survive and both appear in `droppedFields`; pinned fields are returned unchanged even when the model returns different values for them; malformed output raises `CharacterGenerationError`; an unpinned story returns name/description/type with no validation attempted; the two fixture universes both generate through the same call path.

## 5. Server action

- [ ] 5.1 `apps/web/src/lib/rate-limit.ts`: add `character_generate` to `RateLimitedAction` and `POLICIES` (e.g. 30 per hour — a GM iterating on a cast makes many calls, but each is billed).
- [ ] 5.2 `apps/web/src/app/stories/[storyId]/entities/generate-actions.ts` (`'use server'`): `generateCharacterAction(storyId, entityType, prevState, formData)` — `requireUser()`, `assertWithinRateLimit('character_generate', user.id)`, `getStory(storyId, user.id)` for membership, read description/notes/pinned (pinned as a JSON field in form data), call `generateCharacter`, return `{ status: 'ready', draft, droppedFields }` or `{ status: 'error', message, retryable }`. No `revalidatePath` — nothing is persisted.
- [ ] 5.3 `apps/web/src/app/stories/[storyId]/entities/generate-actions.test.ts`: a non-member is rejected before any model call; a rate-limited user is rejected before any model call; a successful call returns the draft; a generation error returns a retryable state and never throws into the form.

## 6. Form surfaces

- [ ] 6.1 `apps/web/src/app/stories/[storyId]/entities/entity-fields/generate-character-panel.tsx` (`'use client'`): description textarea, freeform notes textarea, and a Generate/Regenerate button driven by `useActionState` over `generateCharacterAction`. Renders the dropped-field notice and a retryable error. Lifts the returned draft to its parent via a callback.
- [ ] 6.2 `apps/web/src/app/stories/[storyId]/entities/entity-fields/new-schema-entity-form.tsx`: host the panel above the fields. Hold draft values in state, pass each as the field's value, and track which keys the GM has edited since the last generate — those keys are sent back as `pinned` on the next generate. Keep the existing submit path (`createSchemaEntityAction`) untouched, and include the reserved `description`/`notes` keys in the submitted data.
- [ ] 6.3 `apps/web/src/app/stories/[storyId]/entities/entity-fields/field-renderer.tsx`: accept a controlled `value`/`onChange` alongside the existing `defaultValue` so a generated draft can populate an input and still be edited. Do not change the type dispatch.
- [ ] 6.4 `apps/web/src/app/stories/[storyId]/entities/new-entity-form.tsx`: host the same panel for the unpinned-universe story — the draft supplies name, type, and the reserved `description`/`notes` keys in opaque `data`.
- [ ] 6.5 `apps/web/src/app/stories/[storyId]/entities/entity-fields/parse-form-data.ts`: carry the reserved `description` and `notes` keys through into `data` alongside the schema fields, since they are not in the field list.

## 7. Verification

- [ ] 7.1 `apps/web/src/lib/engine/genre-agnosticism.test.ts` picks up `character-generation.ts` automatically (it scans `lib/engine`); confirm the run covers it and that the module names no universe, genre, or media type.
- [ ] 7.2 From `apps/web`: `npm test`, `npm run typecheck`, `npm run build` all clean.

## 8. Docs

- [ ] 8.1 `docs/docs/architecture/character-generation.md`: the schema-to-prompt construction, the drop-invalid-values rule, the per-field pinning rule, and the freeform notes path into the model. Link it from the architecture index.
- [ ] 8.2 `docs/docs/reference/model-roles.md`: add the `character` row with its default and what it is for.
- [ ] 8.3 `npm run build` in `docs/` stays clean (`onBrokenLinks: 'throw'`).
