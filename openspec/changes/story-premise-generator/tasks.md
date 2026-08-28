# Tasks

## 1. Schema

- [x] 1.1 Write `supabase/migrations/20260827000001_story_premise_drafts.sql`: create `story_premise_drafts` (`id uuid pk default gen_random_uuid()`, `owner_id uuid references auth.users on delete set null`, `status text not null default 'draft' check (status in ('draft','approved','abandoned'))`, `input jsonb not null`, `premise jsonb not null default '{}'::jsonb`, `notes text`, `story_id uuid references stories(id) on delete set null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`). Enable RLS in the same file with owner-only select/insert/update/delete policies on `owner_id = auth.uid()`. Add an index on `(owner_id, created_at desc)`.
- [x] 1.2 Apply the migration (`supabase db push`), then run `supabase db advisors --linked` and `supabase db query --linked --file supabase/tests/rls_coverage.sql`; confirm the new table reports no RLS or search_path gaps.

## 2. Role and rate limit

- [x] 2.1 Add `premise` to `MODEL_ROLES` and `DEFAULT_MODELS` in `lib/ai/roles.ts`, defaulting to the narrator's model. Confirm `modelConfigSchema` picks it up from the enum without further change, and add a `roles.test.ts` case asserting a config lacking `premise` resolves to the default with `usedFallback: true`.
- [x] 2.2 Add a `premise_generate` action to `lib/rate-limit.ts` with its own allowance, separate from `story_create`.

## 3. Premise domain model

- [x] 3.1 Write `lib/engine/premise-schema.ts`: `premiseInputSchema` (`pitch`, `settingSketch`, `toneNotes`, `mustInclude`, `mustAvoid` as optional trimmed strings; `castSize` int 1–8 default 3; `contentRating` enum; `universeId` nullable uuid), refined so at least one of `pitch` / `settingSketch` is non-empty. Add `premiseDocumentSchema` with `tldr`, `setting`, `openingSituation`, `cast`, `hooks`, `toneGuidance`, each wrapped in the `{ status, content, editedContent? }` section shape. Cast members carry their own `kept` flag (default true) so they can be cut individually.
- [x] 3.2 Unit-test the schemas: both-fields-empty rejected, cast size bounds, section status round-trip, edited content stored separately from generated content, cast members defaulting to kept.

## 4. Draft persistence

- [x] 4.1 Write `lib/engine/premise-drafts.ts` (`server-only`): `createPremiseDraft`, `getPremiseDraft`, `listPremiseDrafts`, `savePremiseDocument`, `savePremiseNotes`, `markPremiseDraftApproved`. Every read checks `owner_id` explicitly against the service-role client, and `PremiseDraftNotFoundError` makes a non-owner indistinguishable from a missing draft — mirror `lib/research/drafts.ts`.
- [x] 4.2 Write `premise-drafts.test.ts`: owner reads succeed, non-owner reads raise the not-found shape, null-owner rows survive account deletion.

## 5. Prompt construction

- [x] 5.1 Write `lib/ai/premise-prompt.ts`: build the system prompt (write a premise for a collaborative story; honor the content rating; return only JSON matching the schema) and the user prompt from the intent. Wrap all GM-supplied text through `untrustedSections`. Include the pinned universe's Canon Bible when a universe is set.
- [x] 5.2 Add pinned-section rendering: accepted and edited sections are emitted as settled constraints the model must write around, with edited sections carrying the user's text rather than the generated text.
- [x] 5.3 Write `premise-prompt.test.ts`: untrusted wrapping applied, accepted sections present as constraints, edited sections use the user's text, notes included when present, no genre vocabulary introduced by the prompt builder itself.

## 6. Generation and review

- [x] 6.1 Write `generatePremise` in `lib/engine/premise.ts` (`server-only`): resolve the `premise` role, call `callStructured` with `premiseDocumentSchema`, persist all sections as `pending`. Record usage; on transport failure or exhausted retries, leave the draft untouched and raise a typed error.
- [x] 6.2 Write the review actions — `acceptSection`, `rejectSection`, `editSection`, `setNotes`, and `setCastMemberKept` (cut/restore one member by index, retaining the member either way) — each re-reading the draft through the ownership-checked getter first, matching `lib/research/review.ts`.
- [x] 6.3 Write `regeneratePremise`: collect accepted and edited sections as pins (cast pins include only kept members), no-op with a clear error when nothing is rejected or pending, call the model with pins plus notes, then merge with stored pinned content winning unconditionally over anything returned for those sections.
- [x] 6.4 Write `premise.test.ts` for generation and regeneration: pending sections on first generation, accepted content byte-identical after regeneration, edited content and status preserved, model-returned content for a pinned section discarded, all-accepted regeneration makes no model call, failed regeneration leaves the prior premise intact, cutting one cast member leaves the others kept and is reversible, cut members omitted from regeneration pins.

## 7. Approval

- [x] 7.1 Write `approvePremise`: resolve each section to its effective content (edited over generated, rejected omitted), create the story through the existing `createStory` path, write the resolved premise to `world_ledger.premise`, then create each kept cast member through `createEntity` so history rows and pinned-schema validation both run — cut members seed nothing. Mark the draft approved with its `story_id`, retaining the draft for provenance rather than deleting it.
- [x] 7.2 Handle partial entity failure: keep the story and the entities that succeeded, return which cast members failed, do not roll back.
- [x] 7.3 Extend `premise.test.ts`: story created with owner membership, ledger seeded with resolved content, one `entity_history` row per created cast member, cut members seeding nothing, an all-cut cast still approving successfully, rejected cast section seeds nothing, universe pin carried through, partial failure keeps the story and names the failures, non-owner approval creates no story, draft marked approved with its story id.

## 8. Intent form

- [x] 8.1 Rewrite `app/stories/new/intent-form.tsx`: pitch textarea as the primary field, then a "More options" disclosure holding setting sketch, tone notes, must-include, must-avoid, and cast size. Content rating and optional universe stay visible. No control enumerates genres or media types.
- [x] 8.2 Add `generatePremiseAction` to `app/stories/new/actions.ts` (rate-limit check, parse intent, create draft, generate, redirect to the review route) and keep `createStoryAction` unchanged as the skip path. Wire "Skip and start blank" to it.
- [x] 8.3 Update `app/stories/new/page.tsx` to render the new form.

## 9. Review UI

- [x] 9.1 Write `app/stories/new/[draftId]/page.tsx`: ownership-checked load, 404 on the not-found shape, render each section with its current status.
- [x] 9.2 Write `premise-review.tsx` with per-section Keep / Cut / Edit controls and inline editing, following `app/universes/[draftId]/review/section-review.tsx`. The cast section additionally renders a per-member keep/cut toggle, with cut members shown struck through and restorable.
- [x] 9.3 Write `notes-form.tsx`, `regenerate-button.tsx` (pending state; disabled when every section is accepted), and `approve-button.tsx` (surfaces partial entity failures rather than swallowing them).
- [x] 9.4 Write `app/stories/new/[draftId]/actions.ts` binding each review, regenerate, and approve action, each returning the typed error state the components render.

## 10. Verification

- [x] 10.1 Confirm `genre-agnosticism.test.ts` covers the new engine modules and passes — no genre, media-type, or universe-name branching in `premise.ts`, `premise-drafts.ts`, or `premise-schema.ts`.
- [x] 10.2 Run `npm test`, `npm run typecheck`, and `npm run build` from `apps/web`; all three clean.
- [ ] 10.3 Manual pass: generate a premise, accept two sections, reject one, regenerate, confirm the accepted sections are unchanged, approve, and confirm the story opens at turn 1 with the cast present as entities.

## 11. Docs

- [x] 11.1 Add a story-creation architecture page under `docs/docs/architecture/` covering intent → generate → review → approve, and the pinned-section regeneration rule. Add the `premise` row to the model-roles reference.
- [x] 11.2 Run `npm run build` in `docs/`; confirm clean, with no broken internal links.
