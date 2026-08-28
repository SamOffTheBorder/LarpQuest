## Why

Creating a story today is a three-field form — title, content rating, optional universe id — and then a blank turn 1. Nothing in the product helps a GM answer "what is this story actually about?" The blank page is the hardest moment in the flow, and it is the moment we currently give the least help.

The universe research pipeline already proves the shape that fixes this: describe what you want, a model drafts it, a human reviews it section by section (accept / edit / reject), reruns what they disliked, and publishes only when satisfied. That whole loop lives in `lib/research/` and `app/universes/[draftId]/review/`. A story premise is the same interaction at a much smaller scale — one model call instead of eight stages, no durable job orchestration, seconds instead of minutes.

This change adds a premise step before turn 1: the GM says what kind of story they want, the system drafts a premise, the GM keeps the parts they like and cuts the parts they do not, regenerates until it fits, then starts the story with a populated world instead of an empty one.

**Build-plan phase:** Phase 8 (Polish). Every phase this depends on is complete — the entity system (Phase 2), the research/review pattern being mirrored (Phase 3), and the story-lifecycle creation path being replaced (Phase 1) all exist. This adds no new engine capability; it is a creation-surface improvement built entirely on shipped primitives.

## What Changes

- **Story creation becomes two steps.** `/stories/new` collects intent and generates a premise draft; `/stories/new/[draftId]` reviews it and, on approval, creates the story. The single-shot create path stays reachable — see "Skip" below.

- **Intent capture is guided fields plus a freeform pitch.** The guided fields are all *open-ended text or numbers*, never a fixed genre list: `pitch` (freeform, the primary field), `settingSketch`, `toneNotes`, `mustInclude`, `mustAvoid`, `castSize` (1–8), `contentRating`, and the existing optional `universeId`. Only `pitch` or `settingSketch` is required — everything else is optional and collapsed behind a "More options" disclosure. **No field enumerates genres, media types, or universes**, so no downstream code can branch on one (constraint #1); the model receives free text and returns free text.

- **A new `premise` model role** joins the role table in `lib/ai/roles.ts`, defaulting to the same creative-tier model as `narrator`. Every premise call declares this role, resolves its model from the story-independent default config, parses output through a Zod schema, and writes a `usage_log` row (constraints #6, #7, #8).

- **The generated premise is a sectioned document**, deliberately mirroring `DraftDocument`: `tldr`, `setting`, `openingSituation`, `cast` (array of `{name, type, role, description}`), `hooks` (array of thread strings), and `toneGuidance`. Each section carries `{ status: 'pending' | 'accepted' | 'edited' | 'rejected', content, editedContent? }` — the exact `section()` wrapper `lib/research/draft.ts` already defines.

- **Review is per-section keep / cut / edit, plus a notes box.** The GM marks each section, optionally edits its text inline, and optionally writes freeform feedback. **Regeneration preserves every `accepted` and `edited` section verbatim** — they are passed into the prompt as fixed constraints — and regenerates only `rejected` and `pending` ones, steered by the notes. This is the substance of "what I like and what I don't": likes are pinned, dislikes are re-rolled, and the GM never loses a section they were happy with to an unlucky re-roll.

- **Approval creates the story and seeds the world.** In one server action: create the story via the existing `create_story` RPC (title from the premise, GM-chosen rating, universe pin unchanged), write the resolved premise into `stories.world_ledger.premise`, and create each kept cast member as a real entity through `createEntity` — which writes its `entity_history` row (constraint #3) and validates against the pinned universe schema. Turn 1 then opens against a populated world.

- **Skip stays available.** A "Skip and start blank" action on the intent form creates the story immediately from title + rating alone, exactly as today. Premise generation is never mandatory, and a story created this way is indistinguishable from one created before this change.

- **Drafts are cheap and disposable.** A `story_premise_drafts` row is owned by one user, never gated through `story_members` (no story exists yet) — the same ownership model `universe_drafts` uses and for the same reason. Abandoned drafts are harmless; a `created_at` index supports later cleanup.

## Capabilities

### Added Capabilities
- `story-premise`: intent capture, premise generation, per-section review with pinned-section regeneration, and approval into a seeded story.

### Modified Capabilities
- `story-lifecycle`: story creation gains a premise-assisted path alongside the existing direct path. The "Story creation" requirement gains scenarios for creating from an approved premise (world ledger seeded, cast entities created with history rows) and for skipping premise generation entirely.
- `ai-gateway`: the role table gains `premise`. Covered by the existing role-routing requirement — no new gateway behavior, only a new role entry and its default.

## Non-goals

- **No genre picker, media-type selector, or universe-shaped branching anywhere.** Guided fields are open text and numbers only. Nothing in this change may make engine behavior conditional on genre, universe, or media type.
- **No opening chapter generation.** The premise seeds state, not prose. Chapter 1 is still narrated by the normal turn loop from real player submissions — generating a prologue here would blur whose turn 1 is and duplicate the turn loop's job.
- **No multi-candidate generation.** One premise at a time, refined by regeneration. Generating three and picking one triples cost per attempt for a step the GM is already iterating on.
- **No durable job orchestration.** A premise is one model call taking seconds; it runs inline in a server action with a normal timeout, not through Inngest. The research pipeline needs Inngest because it is eight staged calls over minutes — this is not that.
- **No research, web search, or canon grounding.** When a `universeId` is pinned, the published Canon Bible is passed as context, but this change performs no new research and adds no pipeline stages.
- **No editing the premise after the story starts.** Once approved, `world_ledger.premise` is ordinary story state, changed through the paths that already exist for it. The draft is not kept in sync.
- **No image or media generation** for the premise.

## Impact

- **Schema**: one new table.
  - `supabase/migrations/20260827000001_story_premise_drafts.sql` — `story_premise_drafts` (`id`, `owner_id` references `auth.users` on delete set null, `status` in `draft|approved|abandoned`, `input jsonb`, `premise jsonb`, `notes text`, `story_id` references `stories` on delete set null, `created_at`, `updated_at`). RLS enabled in the same migration (constraint #5); policies are owner-only on `owner_id = auth.uid()` for select/insert/update/delete — deliberately *not* gated through `story_members`, since no story exists while the draft is being reviewed (identical to `universe_drafts`, migration 20260818000001). A `created_at` index supports later cleanup of abandoned drafts.

- **New code**:
  - `lib/engine/premise.ts` (`server-only`) — `premiseInputSchema`, `premiseDocumentSchema` (reusing the `section()` wrapper shape), `generatePremise`, `regeneratePremise` (pins accepted/edited sections), `acceptSection`/`editSection`/`rejectSection`/`setNotes`, and `approvePremise` (creates story + seeds ledger + creates cast entities).
  - `lib/engine/premise-drafts.ts` (`server-only`) — draft CRUD with explicit `owner_id` checks, and a `PremiseDraftNotFoundError` that makes a non-owner and a missing draft indistinguishable, matching `drafts.ts`.
  - `lib/ai/premise-prompt.ts` — system and user prompt construction, including rendering pinned sections as fixed constraints and folding in GM notes. Untrusted GM text is wrapped through the existing `untrustedSections` helper.
  - `app/stories/new/*` — `intent-form.tsx` (guided fields + pitch + disclosure), rewritten `page.tsx`, `actions.ts` gains `generatePremiseAction` and keeps `createStoryAction` for the skip path.
  - `app/stories/new/[draftId]/*` — `page.tsx`, `premise-review.tsx` (per-section keep/cut/edit), `notes-form.tsx`, `regenerate-button.tsx`, `approve-button.tsx`, `actions.ts`.

- **Modified code**:
  - `lib/ai/roles.ts` — add `premise` to `MODEL_ROLES` and `DEFAULT_MODELS`. `modelConfigSchema` is derived from `MODEL_ROLES`, so it picks the role up automatically; existing stories with no entry fall back through `resolveModel` exactly as designed.
  - `lib/rate-limit.ts` — add a `premise_generate` action. Generation is a paid model call reachable before any story exists, so it needs its own limit rather than sharing `story_create`.
  - `app/stories/new/actions.ts` — as above.

- **Cost**: one `premise`-role call per generate or regenerate, billed to the resolving key through the standard gateway path and recorded in `usage_log`. Because no story row exists yet, the call is attributed to the user, and the existing spend-cap guard runs against the user's account rather than a per-story cap.

- **Failure behavior**: a model timeout or transport failure leaves the draft untouched and surfaces a retryable error — the GM's typed intent is never lost. Malformed JSON retries once through `callStructured`'s existing single-retry path, then raises `StructuredOutputError`, which the action renders as a retryable failure; the draft stays reviewable in its prior state. Entity creation failures during approval are the one partial-failure case: the story is already created, so the action reports which cast members failed and leaves them addable by hand rather than rolling back a story the GM can already see.

- **Tests**: `premise.test.ts` (schema validation, pinned-section regeneration preserving accepted/edited content, approval creating entities and history rows, partial entity failure), `premise-drafts.test.ts` (ownership isolation, not-found shape), `premise-prompt.test.ts` (pinned sections rendered as constraints, untrusted wrapping), plus coverage of the new module by `genre-agnosticism.test.ts`.

- **Docs**: `docs/docs/architecture/` gains a story-creation page covering the premise loop; the model-roles reference gains the `premise` role row.
