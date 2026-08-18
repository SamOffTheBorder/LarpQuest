---
sidebar_position: 7
title: Universe Review
---

# Universe Review

:::info Implemented in Phase 3
See [Phase 3 — Research Pipeline](/phases/phase-3-research-pipeline).
:::

Research will be wrong sometimes, and users will want AU divergence (build plan Part 2.3). The review workflow turns a [research pipeline](/architecture/research-pipeline) draft into a published universe version only after a human has looked at every section.

## The draft document

One optional section per stage, each carrying its raw content plus a review status:

```ts
{
  status: 'pending' | 'accepted' | 'edited' | 'rejected',
  content: /* the stage's raw output */,
  editedContent?: /* present only when status is 'edited' */,
}
```

A section is absent until its stage completes or is skipped. `applyStageOutput` is the only function that adds a section — the pipeline writer and the review reader always agree on shape.

## Accept, edit, reject

- **Accept** — the section's status becomes `accepted`; `content` is untouched.
- **Edit** — the owner's replacement value is stored in `editedContent`, status becomes `edited`. The original `content` is never overwritten, so what the research actually said stays visible.
- **Reject** — status becomes `rejected`; `content` stays in place rather than being deleted, so the gaps report and any later re-review can still see what was rejected and why.

Anything downstream that reads a section (the publish mapping, a re-run's upstream context) prefers `editedContent` over `content` when the status is `edited` — an edit is authoritative for whatever gets built on top of it.

## House rules

A freeform rule the owner writes is appended into the rule pack section with `source: 'user'`, distinct from `source: 'research'` rules Stage 7 generated. This reuses the rule pack's own shape rather than a separate table — a house rule *is* a rule, just one the owner authored instead of the research pipeline.

## Marking a fact as AU

Marking a fact as an alternate-universe divergence never mutates the fact:

```ts
export type AuMark = { section: string; path: string; divergenceNote: string };
```

`draft.auMarks` is a flat side-array. The original researched value — value, confidence, source — is exactly what the research produced, before and after the mark. This matters because "mark as AU" is meant to record a *choice*, not silently rewrite what was actually researched; a reviewer (or a later re-run) can still see the canon fact the AU note is diverging from.

## Re-running a stage

Re-running a stage moves its current output to `previous_output` (one generation back, no deeper history) and resets its `research_jobs` row to `queued`, then re-triggers the pipeline scoped to that single stage. The re-run reads upstream context from the *persisted* draft document — including any edits — through the same `stage-request.ts` dispatcher the full pipeline uses, so a re-run asks the pipeline's original question rather than a subtly different one. The review UI shows a structural diff between `previous_output` and the new `output` once the re-run completes.

## Publishing

Publishing maps the accepted draft to Phase 2's existing `UniverseVersionInput` and calls `createUniverse` unchanged:

```ts
export function draftToUniverseVersionInput(
  draftId: string,
  name: string,
  document: DraftDocument,
): UniverseVersionInput
```

Only the Schema Derivation section is strictly required — it is the only section that feeds the entity schema and progression model a version actually needs. A draft whose Schema Derivation is still `pending` or `rejected` fails publish with a `DraftIncompleteError` naming that section, without calling `createUniverse` at all. Every other section (rules, entities, timeline, rule pack) informs the Canon Bible a story reads later, not the version object itself.

On success, `universe_drafts.status` becomes `published` and the row records the resulting `universe_id`/`published_version` — the draft row is never deleted, so there's a permanent record of what was reviewed and what it became.

## Why drafts are owned by a user, not gated through `story_members`

Every other table in this schema is accessed through `is_story_member()`. A draft exists before any story does, so `universe_drafts` and `research_jobs` use `owner_id = auth.uid()` instead — the one documented exception to the pattern, called out explicitly in the migration that creates these tables so it isn't copied elsewhere by mistake.
