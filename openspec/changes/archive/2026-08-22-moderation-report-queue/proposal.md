## Why

`story_reports` and `listReports()` already exist (Phase 5) and are already surfaced as a read-only
list on the Members page. But a report today is a dead end: an owner/GM can see that a chapter or
submission was reported and why, but has no way to act on it — no way to mark it resolved, and no
way to remove or hide the offending content. LAUNCH_PLAN.md item B2.3 names this gap explicitly:
"story_reports exists; nothing surfaces it. At minimum: a report queue, user suspension, and
content removal." The report queue itself is done; user suspension already exists in a per-story
form (`removeMember`, ejects a member from the story, already reachable from the Members page).
What remains and is genuinely missing is: marking a report reviewed, and removing/hiding reported
content.

This is scoped to per-story moderation only, exercised by the existing `owner`/`gm` roles — this
codebase has no platform-wide admin concept, and introducing one (a cross-story queue, an
account-level suspension that blocks sign-in) is a materially larger, separately-reviewable change
with its own security surface. That is out of scope here.

## What Changes

- Add a `status` column to `story_reports` (`open` / `resolved`, default `open`) so a report can be
  marked reviewed without deleting the row — reports stay append-only in the sense that matters
  (the original report text and reporter are never altered or removed), consistent with the
  existing "no update or delete policy" comment, which this narrows to "no delete, and the only
  permitted update is the status transition."
- Add a `hidden_at` / `hidden_by` pair of columns to `chapters`, set when an owner/GM hides a
  reported chapter. A hidden chapter's prose is not deleted (Prose is disposable, state is
  permanent applies to the DB row generally, but here specifically: `entity_history` derived from
  a hidden chapter's extraction already happened and is not retroactively undone — hiding affects
  only what is rendered, not story state) but is excluded from what other members can read; owner/
  GM can still see it (to confirm what they hid) and can unhide it.
- Because `submissions` are used for regeneration/retry (CLAUDE.md rule 4: "no generation outcome
  may delete or alter a submission"), a reported *submission* cannot be hidden the same way a
  chapter can without breaking that guarantee. Reported submissions are handled by marking the
  report resolved only — no content-removal action for submissions in this change. (A submission
  that generated an actual chapter is addressed via the chapter it produced, if any.)
- Extend `listReports`/`resolveReport` in `lib/engine/reports.ts` and add `hideChapter`/
  `unhideChapter` to `lib/engine/chapters.ts`, both owner/GM-gated the same way `removeMember` is.
- Update the Members page's `ReportList` to show status, link each report to its target content,
  and add "Resolve" / "Hide chapter" / "Unhide chapter" actions for managers.
- Update chapter read paths (story view, export, search) to exclude hidden chapters for non-
  manager members, matching how RLS/engine code already gates on role elsewhere.

## Capabilities

### New Capabilities
(none — this extends the existing `room-safety` capability's reporting requirement rather than
introducing a new domain)

### Modified Capabilities
- `room-safety`: the "Per-story reporting" requirement gains report resolution and linked content
  removal — an owner/GM can now act on a report, not just view it.

## Impact

- New migration: adds `status` to `story_reports`, `hidden_at`/`hidden_by` to `chapters`, with RLS
  policy updates for both (CLAUDE.md rule 5).
- Modified: `apps/web/src/lib/engine/reports.ts`, `apps/web/src/lib/engine/chapters.ts`,
  `apps/web/src/app/stories/[storyId]/members/{report-list.tsx,actions.ts,page.tsx}`.
- Read paths that list/render chapters for non-managers must filter out hidden ones — audit
  `listChapters` and any direct chapter reads (story page, export, search, baseline view) for this.
- No AI model call, no change to turn loop or generation. Build plan phase: Polish / post-engine
  operational hardening per LAUNCH_PLAN.md Part 3 Track B2, same category as the already-archived
  `account-deletion` and `rate-limiting` changes.

## Non-goals

- No platform-wide/cross-story admin role, no account-level suspension that blocks sign-in
  entirely — flagged in LAUNCH_PLAN.md as a materially larger change, deferred.
- No CAPTCHA, ban evasion handling, or crisis-resource UI — separate LAUNCH_PLAN items (B2.4,
  B2.6, B3.2).
- No moderation of submissions' content beyond marking a report resolved — submissions remain
  immutable per CLAUDE.md rule 4.
- No changes to the automated `moderator` role or its fail-open behavior (LAUNCH_PLAN B2.2) — this
  change is about human-driven report handling after the fact, not the automated pre-publication
  check.
