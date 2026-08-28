## Context

The premise step sits between "user wants a story" and "turn 1 opens." It is the first surface in the product where a model writes something the user is expected to reject freely and repeatedly, which makes the review loop — not the generation — the part worth designing carefully.

Two existing systems constrain the design. The universe research pipeline (`lib/research/`) already implements draft → sectioned document → per-section review → rerun → publish, and reusing its vocabulary keeps two similar surfaces from drifting apart. The engine's non-negotiable constraint #1 — no conditionals on genre, universe, or media type — constrains the *input* design, because "guided fields" is exactly the shape that tends to smuggle a genre enum into the codebase.

## Goals / Non-Goals

**Goals**
- Make the blank page rare: a GM who does not know what they want gets something concrete to react to.
- Preserve what the GM liked across regeneration. A re-roll must never cost them a section they already approved.
- Seed real state, so turn 1 has a world to narrate against.
- Stay a creation-surface change: no new engine capability, no new orchestration.

**Non-Goals**
- Not a research pipeline. No web search, no canon derivation, no staged jobs.
- Not a chapter generator. The premise is state, not prose.
- Not a universe builder. A premise describes one story; a universe describes a world many stories share.

## Decisions

### 1. Guided fields are open text, never enumerations

**Decision:** Every guided field is free text or a number. No genre dropdown, no media-type selector, no tone enum.

The user asked for guided fields to make story creation easy. The obvious implementation — `genre: 'noir' | 'fantasy' | ...` — would put a genre vocabulary into a schema, and from there into prompts, database rows, and eventually a branch somewhere. That is precisely what constraint #1 forbids, and the `genre-agnosticism.test.ts` scan for `genre_tags ===` exists because this failure mode is expected.

The guidance therefore comes from *what each field asks*, not from a menu of answers. `settingSketch` placeholdered with "a rain-soaked arcology city" guides as effectively as a dropdown, costs nothing in engine coupling, and does not cap the GM at the genres we thought of. Structure lives in the labels; freedom lives in the values.

**Consequence:** the model does more interpretive work on free text, which is what it is good at. Nothing downstream can branch on genre because nothing downstream ever receives a genre token.

### 2. The premise document reuses the research draft's section wrapper

**Decision:** `premiseDocumentSchema` composes the same `{ status, content, editedContent? }` shape as `lib/research/draft.ts`, with the same four statuses.

The review UIs are the same interaction. Sharing the shape means the review components, the accept/edit/reject actions, and the mental model transfer directly, and a later refactor can hoist the wrapper into one module.

**Rejected:** a flat `{ tldr: string, setting: string, ... }` with a separate `keptSections: string[]`. Simpler to write, but it splits a section's content from its review state, which is exactly the coupling the research code learned to keep together — and it has no place to put an inline edit.

### 3. Regeneration pins accepted and edited sections rather than merging afterward

**Decision:** accepted and edited sections are rendered into the regeneration prompt as fixed constraints ("these parts are settled, write around them"), and the response is merged back with the pinned sections' stored content winning unconditionally.

Two mechanisms, deliberately both. The prompt constraint makes the *new* sections coherent with the kept ones — a regenerated opening situation that ignores the kept cast would be useless. The unconditional merge guarantees the kept content is byte-identical afterward even if the model rewrites it anyway. Prompting alone would risk silent drift in a section the GM already approved; merging alone would produce a premise whose parts contradict each other.

This is the mechanical answer to "what I like and what I don't." Likes are pinned and immune to re-rolls; dislikes are the only thing that changes.

**Rejected:** regenerating everything and diffing. It burns tokens on settled content and reintroduces the drift the pin exists to prevent.

### 4. Notes are freeform and apply to the whole regeneration

**Decision:** one notes field, not per-section critique boxes.

Per-section notes sound more precise but produce a form with six textareas that GMs will leave empty. The rejection itself already carries the per-section signal ("not this"); the notes carry the cross-cutting steer ("less chosen-one, more ensemble") that does not belong to any one section. Notes are advisory to the next generation, not persisted into the approved premise.

### 5. The draft is owner-scoped, not member-scoped

**Decision:** `story_premise_drafts.owner_id` with owner-only RLS, not gated through `story_members`.

No story exists during review, so there is no membership to gate on — the same reasoning that made `universe_drafts` owner-scoped. RLS is still enabled in the creating migration (constraint #5); the gate is `owner_id = auth.uid()` rather than a `story_members` join. Reads through the service-role client check `owner_id` explicitly, since that client bypasses RLS — the discipline `drafts.ts` and `stories.ts` already follow.

### 6. Approval creates entities through `createEntity`, not a bulk insert

**Decision:** each kept cast member is created through the existing `createEntity`, one call each.

`createEntity` writes the `entity_history` row via `create_entity_with_history` (constraint #3) and validates against the pinned universe schema. Bypassing it with a bulk insert would silently skip both. The cast is at most 8 entities, so the per-call cost is irrelevant next to correctness.

**Consequence — partial failure is possible.** The story row is created before the entities. If entity 3 of 5 fails schema validation, the story exists with a partial cast. The action reports exactly which cast members failed and leaves them addable by hand; it does not roll back a story the GM can already see and may already be in. Rolling back would be worse: it discards a valid story and a completed premise review over a fixable data problem.

### 7. Generation runs inline, not through Inngest

**Decision:** `generatePremise` is called directly from a server action.

One model call, seconds long, with a user watching. Inngest exists in this codebase for the research pipeline's eight staged calls over minutes, where durability across a page close genuinely matters. Here, a failure is recoverable by pressing the button again, and the typed intent is already persisted on the draft — so the user never retypes anything. Adding durable orchestration would buy nothing and add a moving part.

**Failure behavior:** transport failure or timeout leaves the draft untouched and surfaces a retryable error. Malformed JSON retries once inside `callStructured`, then raises `StructuredOutputError`; the draft stays in its prior reviewable state, so a failed regeneration never destroys the premise the GM was already looking at.

### 8. A new `premise` role rather than reusing `narrator`

**Decision:** add `premise` to `MODEL_ROLES`, defaulting to the same model as `narrator`.

Constraint #6 requires every call to declare a role, and roles exist so their models can diverge. Premise writing and chapter narration have genuinely different demands — one is structured JSON world-building, the other is streamed prose — and a GM who wants a cheaper model for premise iteration while keeping an expensive narrator should be able to say so. Defaulting them to the same model means the distinction costs nothing today and is available the moment it matters.

`modelConfigSchema` derives from `MODEL_ROLES`, so it picks the role up automatically. Existing stories have no `premise` entry and fall back through `resolveModel` with `usedFallback: true` — the designed behavior, not a migration concern.

## Risks / Trade-offs

- **The premise may not survive contact with play.** The GM approves a premise, then chapter 4 goes somewhere else entirely, and `world_ledger.premise` becomes stale. Accepted: the premise is a starting condition, not a contract. Prose is disposable and state is permanent, and the premise is state that later state supersedes. Keeping it in sync with the story's actual direction is a separate concern from creating it.
- **Cost before value.** Generation spends tokens before a story exists, so an abandoned draft is pure loss. Mitigated by the `premise_generate` rate limit and by keeping the skip path prominent — a GM who knows what they want should never pay for a premise.
- **Guided fields may still feel narrow.** Free-text fields with placeholders guide less firmly than a menu. This is the accepted price of constraint #1, and the freeform pitch field is deliberately primary so the fields never become the only way in.
- **Attribution before story creation.** Usage is logged against the user rather than a story, so premise spend does not appear in per-story cost views. Correct — the spend genuinely is not attributable to a story that may never exist — but it means a GM iterating heavily sees that cost only in account-level spending.

## Migration Plan

Additive throughout. The new table is created with RLS in its own migration; no existing table, column, or RPC changes shape.

`createStoryAction` keeps its current signature and behavior, so the skip path is the existing code path rather than a reimplementation of it. Stories created before this change have no `world_ledger.premise` key and are unaffected — nothing reads the key as required.

Rollout is a straight deploy: migration first, then the app. Between the two, the new routes 404 and the old form keeps working.

### 9. Cast members are kept or cut individually

**Decision:** the cast section carries a per-member keep/cut state in addition to its section status. Every other section is reviewed whole.

The cast is the one section that is a list of independent things rather than one piece of prose, and "I like two of these three characters" is the most likely single piece of feedback in the flow. Forcing that through a whole-section cut throws away two good characters to remove one bad one, and forcing it through a freeform edit makes the GM retype what the model already got right.

Cut members are retained in the stored section rather than deleted, exactly as a rejected section retains its content — so a cut can be undone, and regeneration can see what was rejected instead of silently reproposing it. Seeding creates entities only for kept members.

**Consequence:** `cast` needs a slightly richer content shape than the other sections (each member carries its own `kept` flag). This is contained: the section wrapper is unchanged, and only the cast's inner content type differs, which it already did by being an array.

**Rejected:** a separate `cutCastMemberIds` side-list on the draft. It splits a member's state from the member, which is the same coupling mistake decision 2 rejected for sections.

## Open Questions

None outstanding. The two questions raised during design — draft retention after approval, and cast editing granularity — are resolved above and in decision 9: approved drafts are kept with `status='approved'` and `story_id` set so "how was this story created?" stays answerable, with the `created_at` index available for a retention policy if drafts ever accumulate meaningfully.
