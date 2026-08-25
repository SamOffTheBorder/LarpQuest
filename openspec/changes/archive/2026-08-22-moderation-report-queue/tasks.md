## 1. Migration: report resolution

- [x] 1.1 Add `status text not null default 'open' check (status in ('open', 'resolved'))`,
      `resolved_by uuid references auth.users on delete set null`, `resolved_at timestamptz` to
      `story_reports`.
- [x] 1.2 Add a `BEFORE UPDATE` trigger on `story_reports` that raises unless `reason`,
      `reporter_id`, `chapter_id`, `submission_id`, and `created_at` are unchanged from `OLD` —
      only `status`/`resolved_by`/`resolved_at` may change.
- [x] 1.3 Add an UPDATE RLS policy on `story_reports`: `is_story_role(story_id, array['owner',
      'gm'])`, relying on the trigger from 1.2 to restrict which columns actually change.

## 2. Migration: chapter hiding

- [x] 2.1 Add `hidden_at timestamptz` and `hidden_by uuid references auth.users on delete set
      null` to `chapters`.
- [x] 2.2 Confirm existing `chapters` RLS select policy needs no change (hiding is
      application-filtered per design.md, not RLS-filtered) — documented in the migration file's
      comment.
- [x] 2.3 No new RLS update policy needed: `chapters` already has a permissive
      `chapters_update` policy for any story member (existing, pre-dating this change), but
      `hideChapter`/`unhideChapter` will run through the service-role client gated by
      `requireRole` in application code — the same pattern `membership.ts` already documents for
      every other owner/GM-only mutation (e.g. `removeMember`). No RLS change required.

## 3. Migration: search exclusion

- [x] 3.1 Update the `search_story` function definition to add `and chapters.hidden_at is null`
      to its chapter-matching branch.

## 4. Engine: reports

- [x] 4.1 Add `resolveReport(reportId, userId)` to `lib/engine/reports.ts`: owner/GM-gated via
      `requireRole`, updates status/resolved_by/resolved_at.
- [x] 4.2 Extend `Report`/`ReportRow` and `toReport` with `status`, `resolvedBy`, `resolvedAt`.

## 5. Engine: chapter hiding

- [x] 5.1 Add `hideChapter(chapterId, userId)` and `unhideChapter(chapterId, userId)` to
      `lib/engine/chapters.ts`: resolve the chapter's `story_id`, `requireRole(storyId, userId,
      ['owner', 'gm'])`, then update `hidden_at`/`hidden_by`.
- [x] 5.2 Extend `Chapter`/`ChapterRow`/`toChapter` with `hiddenAt`, `hiddenBy`.
- [x] 5.3 Update `listChapters` to look up the caller's manager status via the existing
      `listMembers`/role-check pattern already used in the Members and Consistency pages, and
      omit hidden chapters for non-managers.
- [x] 5.4 Update `readExportableChapters` in `lib/engine/export.ts` to add `.is('hidden_at',
      null)` alongside the existing `.is('rolled_back_at', null)` filter.
- [x] 5.5 Update `getSharedStoryView` in `lib/engine/share-links.ts` the same way.

## 6. UI: Members page report actions

- [x] 6.1 Update `ReportList` to show status (open/resolved badge). (Deviation from the original
      task: no separate "link to target" was added — chapter hiding is actioned directly on the
      story page where the chapter is already rendered in full, so a Members-page link would only
      duplicate that surface.)
- [x] 6.2 Add a "Resolve" action (server action + button) visible to managers on `open` reports.
- [x] 6.3 Hide/unhide lives on the story page (`HideChapterButton`), not the Members page — it
      sits next to the chapter it acts on, following the same placement `RollbackButton` already
      uses. New `stories/[storyId]/moderation-actions.ts` holds all three moderation server
      actions (hide, unhide, resolve).

## 7. UI: hidden-chapter visibility on the story page

- [x] 7.1 For managers, show hidden chapters in the story page's chapter list with a "Hidden from
      members" badge and a toggle button.
- [x] 7.2 No gap marker needed: `listChapters` (task 5.3) already omits hidden chapters from
      non-managers entirely at the query level, so there is no partial/placeholder state to
      render for them — the turn-number gap is simply absent from what they receive, which is
      simpler than design.md's open question anticipated and needs no additional UI.

## 8. Verification

- [x] 8.1 `supabase db push` applied both migrations to the linked project. `supabase db
      advisors --linked` flagged a mutable search_path on the new trigger function, fixed by a
      follow-up migration (`20260825000002`) and re-verified clean. `supabase db query --linked
      --file supabase/tests/rls_coverage.sql` fails on its first check, but that failure
      (`rate_limit_counters` has RLS enabled with no policy) pre-dates this change — it comes
      from the `rate-limiting` change already archived before this one started, not from
      anything added here. The second check (append-only tables must have no DELETE policy) was
      run in isolation and passes for `story_reports`, confirming this change did not add one.
- [x] 8.2 Extended `apps/web/src/lib/engine/reports.test.ts` with resolve-report cases (success,
      immutability of original fields, non-manager rejected, not-found).
- [x] 8.3 Added `apps/web/src/lib/engine/chapters.test.ts` (new — no prior test file existed) with
      hide/unhide cases: owner can hide/unhide, non-manager rejected, not-found rejected, hidden
      chapter excluded from non-manager `listChapters`, included for managers. (export.ts and
      share-links.ts filters are one-line additions matching the existing `rolled_back_at`
      pattern exactly — no new test scaffolding for those two files existed before this change
      either, and duplicating the same assertion three times without an existing harness for
      either file was judged lower value than covering the new engine functions and the
      trigger/RLS behavior live against the database.)
- [x] 8.4 `search.test.ts` mocks the `search_story` RPC entirely (by design — the ranking/
      membership logic lives in SQL, not re-tested at the JS layer, per that file's own comment),
      so a hidden-chapter case there would only test the mock. Verified instead by reading the
      deployed function body directly: `select prosrc from pg_proc where proname = 'search_story'`
      against the linked project confirms `hidden_at is null` is present in the pushed function.
- [x] 8.5 Ran `npm test` (496 passed, +11 from this change), `npm run typecheck`, `npm run build`
      in `apps/web` — all three clean.
