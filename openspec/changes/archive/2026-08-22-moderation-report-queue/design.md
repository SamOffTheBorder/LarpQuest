## Context

`story_reports` (migration `20260820000002`) already has select/insert RLS gated through
`is_story_role(story_id, array['owner', 'gm'])` for select and `is_story_member` for insert, with
an explicit "no update or delete policy: reports are append-only." `listReports()` and a read-only
`ReportList` component already exist on the Members page. What's missing is any way to act on a
report: mark it handled, or remove the content it points at.

Chapter reads for members fan out through several code paths that query `chapters` directly rather
than through a single shared function:
- `lib/engine/chapters.ts`'s `listChapters` — used by the story page, consistency report, baseline
  view.
- `lib/engine/export.ts`'s `readExportableChapters` — direct query, already filters
  `rolled_back_at is null`.
- `lib/engine/share-links.ts`'s `getSharedStoryView` — direct query, same existing filter.
- `search_story` (Postgres function, migration `20260823000003`) — full-text search, queries
  `chapters` server-side via RPC.

Several other files touch `chapters` (memory-worker, extraction-worker, chapter-illustration,
chapter-video, image-prompts, canon-exceptions, consistency-report, turns) but these are internal
engine/pipeline reads, not member-facing content surfaces — they must keep seeing hidden chapters
unchanged, since hiding is a display concern, not a state concern (extracted diffs, embeddings,
and validation reports already derived from a chapter are not undone by hiding it, matching how
`rollbackChapter` already treats "chapter stays visible, only entity effects reverse" as a
separate axis from visibility).

## Goals / Non-Goals

**Goals:**
- An owner/GM can mark a report `resolved` without deleting the report row.
- An owner/GM can hide a reported chapter from other members; the story page, export, share links,
  and search all stop surfacing it to non-managers. An owner/GM can still see and unhide it.
- No change to submission immutability (CLAUDE.md rule 4) — reported submissions get status
  resolution only, no removal action.

**Non-Goals:**
- No cross-story or platform-level admin surface.
- No change to what happens to a hidden chapter's already-derived state (`entity_history`,
  embeddings, validation reports) — those are untouched, matching how rollback already separates
  "visible" from "in effect."
- No automatic action from a report being filed (e.g., auto-hide at N reports) — every action here
  is owner/GM-initiated.

## Decisions

**`status` on `story_reports`, not a new table.** A two-value `open`/`resolved` column plus
`resolved_by`/`resolved_at` is the minimal change that satisfies "mark reviewed" while keeping the
original report row (reason, reporter, target) permanently intact — nothing about the report
itself is ever altered, only a resolution is layered on top. Alternative considered: a separate
`report_resolutions` table — rejected as unnecessary indirection for a single status flag; nothing
else references resolution history yet.

**Update policy addition, not removal, of "no update" comment's intent.** The existing RLS has no
update policy at all. This change adds one scoped narrowly: owner/GM can update only `status`,
`resolved_by`, `resolved_at` — not `reason`, `reporter_id`, or the target columns. Postgres RLS
can't restrict *which columns* an UPDATE touches directly; the standard way is a trigger (or a
`CHECK`) that rejects a row where any immutable column differs from the old row. Use a `BEFORE
UPDATE` trigger that raises if `reason`, `reporter_id`, `chapter_id`, `submission_id`, or
`created_at` differ from `OLD`. Alternative considered: a Postgres RPC function
(`resolve_report(report_id)`) instead of a raw UPDATE + trigger — rejected as extra surface for no
real benefit; the trigger approach matches how this codebase already protects immutability
elsewhere (append-only `entity_history`) without needing a dedicated function per mutation.

**`hidden_at`/`hidden_by` on `chapters`, not a soft-delete `deleted_at`.** "Hidden" is the accurate
name: the row, its prose, and everything derived from it stay exactly as they are; only what
regular members are shown changes. Naming it `deleted_at` would misstate what happens and invite a
future reader to assume cascading deletion semantics that don't apply here. Two columns rather than
one boolean: `hidden_by` records which owner/GM acted, useful the same way `resolved_by` is, and
matches the audit-friendliness the rest of this codebase already practices (e.g. `joined_via_invite`
on `story_members`).

**Filtering happens at each of the three query sites (`listChapters`, `readExportableChapters`,
`getSharedStoryView`) plus inside `search_story`, not through a new shared read function.** These
three application-level sites already have different shapes (different columns selected, different
membership-check patterns — `listChapters` checks `assertMember` and returns full `Chapter[]`,
export and share-links return a narrower shape and don't take a `userId` the same way). Consolidating
them into one shared reader is a larger refactor than this change's scope; instead, each site adds
`.is('hidden_at', null)` conditionally (see below), following the exact pattern already used for
`rolled_back_at is null` in export and share-links. `search_story` gets `and c.hidden_at is null`
added to its `WHERE` clause directly in a new migration, following the existing function's own
structure.

**Manager visibility is a parameter, not a second unfiltered function.** `listChapters(storyId,
userId)` already knows the caller; it can look up whether `userId` is owner/GM (reusing the same
role check `requireRole`/`listMembers` already perform) and skip the `hidden_at` filter only for
them. Export and share-links have no notion of "the current viewer" — export runs for the
requesting member via a job, and share links are unauthenticated — so both **always** filter hidden
chapters unconditionally: an owner/GM who wants to review a hidden chapter uses the story page, not
a share link or export bundle. This asymmetry is deliberate, not an oversight: exports and public
share links are exactly the surfaces where a hidden chapter's whole point (don't show this to
people who aren't already looking at it as a manager) matters most.

## Risks / Trade-offs

**[Risk] A manager hides a chapter, then transfers ownership or leaves — a later manager needs to
know it happened.** → Mitigation: `hidden_by` is preserved regardless of the acting user's later
role changes (FK is `on delete set null`, matching every other user-reference FK in this schema
per the account-deletion precedent); the story page's manager view always lists hidden chapters
with their hidden-by/hidden-at metadata, so nothing is silently invisible to managers.

**[Risk] Hiding a chapter that other chapters' prose narratively depends on creates a confusing
read for members.** → Mitigation: out of scope to solve narratively — this is the same trade-off
inherent to any retraction. The story page's non-hidden chapter list will show a turn-number gap or
placeholder rather than silently renumbering, so the discontinuity is visible rather than hidden
twice over. (Concrete UI choice belongs in tasks, not this design — flagged for the implementer to
decide the exact gap-marker rendering, consistent with existing `ErrorState`/`Badge` patterns
already in the Members and Consistency pages.)

**[Risk] `search_story`'s SQL changes without a corresponding test regression check.** →
Mitigation: `supabase/tests/rls_coverage.sql` and `db advisors --linked` are already the
project's standard post-migration checks (CLAUDE.md gotchas); run both after this migration, plus
the existing `search.test.ts` extended with a hidden-chapter case.

## Migration Plan

1. New migration: `story_reports.status`/`resolved_by`/`resolved_at` + immutability trigger +
   update RLS policy; `chapters.hidden_at`/`hidden_by` + RLS consideration (chapters' existing
   select policy is member-gated already; hiding doesn't change *who* can query the row via RLS,
   only what application code chooses to return, since RLS has no way to know "is this user a
   manager" cheaply per-row without a second lookup — the existing `is_story_role` helper handles
   that if needed, but the simplest correct approach is application-level filtering as decided
   above, so RLS itself does not need to change for `chapters` beyond what already exists).
2. Update `search_story` function definition in a new migration to add the `hidden_at is null`
   predicate.
3. Engine functions (`resolveReport`, `hideChapter`, `unhideChapter`) + query-site filters.
4. UI: report actions, hidden-chapter indicator for managers, gap marker for members.
5. Run `supabase db advisors --linked` and the RLS coverage test after the migration.
6. Rollback: a down migration is not this project's pattern (no prior migration includes one); if
   needed, a compensating migration dropping the added columns/trigger/policy would be written by
   hand, same as any other migration here.

## Open Questions

- Exact UI treatment of the "gap" left in a member's chapter list by a hidden chapter (placeholder
  card vs. silent renumbering vs. an explicit "A chapter here was removed by a moderator" notice)
  is left to implementation — no existing precedent in this codebase to follow exactly, so the
  tasks phase should pick the simplest option consistent with `ErrorState`'s existing tone.
