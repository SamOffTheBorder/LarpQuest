## Context

`account-deletion.ts` already establishes the boundary between "the user's own data" (profile,
email, API keys — deleted/anonymized) and "story content" (chapters, other members' data —
preserved, since deleting one member's account must not destroy a collaborative story). This
export follows the same boundary in the opposite direction: it bundles what belongs to the user,
not what belongs to the stories they participate in.

`requestExport` in `export.ts` is a *story* export (any member, all of a story's chapters,
storage-bucket-backed, async job row) — a different shape and audience from what's needed here. An
account export is user-scoped, not story-scoped, and small enough (profile + a list of a few
hundred rows at most for even a heavy user) to render synchronously in one request/response cycle
with no storage bucket or job-status polling.

## Goals / Non-Goals

**Goals:**
- A signed-in user can download a single JSON file containing every piece of data this schema
  attributes to them personally.
- The export never includes another user's identity, another member's submissions, story prose, or
  any decrypted secret.
- No new persisted state — this is a read-and-render operation.

**Non-Goals:**
- No async job, no storage bucket, no polling UI — direct synchronous response.
- No format other than JSON.
- No re-import path (this is export only, not account migration/restore).

## Decisions

**One function, one JSON shape, not a per-table endpoint.** `requestAccountExport(userId)` queries
each relevant table under the service-role client (needed because it must aggregate across every
story the user has ever been part of, which their own RLS-scoped session cannot do in one query for
the same reason `account-deletion.ts`'s sole-ownership check needs the service role) and assembles
one object. Alternative considered: a set of smaller per-category functions — rejected as
unnecessary indirection when there is exactly one caller (the download route) and one shape.

**Synchronous response, not `export_jobs`.** `export_jobs` exists because PDF/EPUB rendering of a
long story is nontrivial CPU work best tracked as a job with retry/status. An account's own data
(profile row, preference row, a list of submissions/reports/usage rows, never story prose) is
orders of magnitude smaller and requires no binary rendering — JSON.stringify of already-fetched
rows. A synchronous response matches the actual cost of the operation; adding job-tracking
machinery here would be complexity with no corresponding problem it solves.

**API key rows are included, ciphertext excluded.** `label`, `scope`, `story_id` (if story-scoped),
and `created_at` describe what keys exist without exposing anything usable — `encrypted_key` is
AES-256-GCM ciphertext under a master key that lives only in the deployment's environment
(`crypto.ts`), so it's useless outside this deployment even if leaked, but omitting it entirely is
the simpler and safer default: an export is exactly the kind of artifact a user might paste
somewhere or store insecurely, and there's no data-portability reason to include ciphertext they
can't decrypt themselves anyway.

**Story membership is included; other members and story prose are not.** Mirrors
`account-deletion.ts`'s existing precedent exactly: a story is collaborative content, not one
member's personal data. The export lists which stories the user belongs to, their role, and when
they joined (from `story_members`, already scoped to `user_id = requesting user` — no query needs
to touch another member's row).

**Submissions are included in full.** Unlike chapters (generated, collaborative, story-owned),
`content` in `submissions` is text the requesting user personally wrote (CLAUDE.md rule 4:
submissions persist independently of generation, are the user's own authored contribution). This is
squarely "their data" the way a chapter is not.

## Risks / Trade-offs

**[Risk] A user with a very long history (many stories, years of usage_log rows) makes the
synchronous response slow or memory-heavy.** → Mitigation: accepted as a non-issue at this
deployment's actual scale (LAUNCH_PLAN's own Tier A is "5-10 people you know"); if this becomes real
at Tier B/C scale, pagination or a background job is a natural follow-up, not something to build
speculatively now.

**[Risk] Someone assumes this export can be used to restore/re-import an account, and is
disappointed it can't.** → Mitigation: the proposal's non-goals state this explicitly; the
in-app copy accompanying the download button should say "a copy of your data" not "a backup."

## Migration Plan

1. Add `lib/engine/account-export.ts` with `requestAccountExport`.
2. Add a route handler (not a server action, since this returns a file download rather than
   redirecting/revalidating — matches how `getExportDownloadUrl` returns a URL rather than a page
   state) at `app/settings/account/export/route.ts` that calls it and returns
   `application/json` with a `Content-Disposition: attachment` header.
3. Add a download link/button on `/settings/account`.
4. No rollback concerns — no persisted state to unwind.

## Open Questions

None — the scope and shape follow directly from `account-deletion.ts`'s existing precedent for
what counts as "the user's data" versus "story content."
