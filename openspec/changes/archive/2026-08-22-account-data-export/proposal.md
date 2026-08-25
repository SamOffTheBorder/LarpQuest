## Why

LAUNCH_PLAN.md item C1.2 calls for "extend story export to a full account export" — data
portability alongside the account deletion already shipped (`account-deletion.ts`). A user who
deletes their account today has no prior way to get a copy of what they contributed; deletion is
one-way and anonymizing (owner/user references become null, profile and API keys are removed
outright per `account-deletion.ts`'s own docstring), so an export offered *after* deletion is too
late. This closes that gap: a self-serve export of a user's own account data, available any time,
independent of the deletion flow.

## What Changes

- Add `requestAccountExport(userId)` producing a single JSON file (not Markdown/PDF/EPUB — this is
  data portability, not a readable narrative export, so the existing `story-export` capability's
  formats don't apply) containing:
  - Profile: username, appearance preferences (`user_preferences`).
  - Story memberships: which stories they belong to, their role, when they joined — not other
    members' identities or the story's prose/chapters, which are the story's collaborative content,
    not this user's personal data (same boundary `account-deletion.ts` already draws: their account
    is deleted, not the story).
  - Their own submissions across every story they've been part of (the actual turn text they wrote
    — CLAUDE.md rule 4 already treats submissions as durable and independent of generation, so this
    is genuinely "their content").
  - Reports they filed (`story_reports` where they are `reporter_id`) and reports' resolution
    status.
  - Usage/spend history (`usage_log` where they are `user_id`) — cost transparency they already see
    piecemeal in `/settings/spending`, bundled here.
  - API key metadata (`label`, `scope`, `created_at`) for keys they own — **never** the encrypted
    key material itself, which is meaningless outside this deployment's master key and is exactly
    the kind of secret an export must not leak.
- Add `/settings/account/export` (or a button on the existing `/settings/account` page) that
  triggers the export and returns a downloadable JSON file directly in the response — no storage
  bucket, no job/polling needed, unlike `export_jobs` (a full account's data is small compared to
  binary PDF/EPUB rendering, so there's no need for the async job pattern `requestExport` uses).
- No new database table. No RLS changes — every read this needs is already scoped to `user_id =
  auth.uid()` or reachable through existing owner-gated engine functions.

## Capabilities

### New Capabilities
- `account-data-export`: a user's self-serve export of their own account data as a single JSON
  file, independent of and prior to account deletion.

### Modified Capabilities
(none — this is additive; it does not change `account-deletion` or `story-export`'s existing
requirements)

## Impact

- New file: `apps/web/src/lib/engine/account-export.ts`.
- New route/UI: a download action reachable from `/settings/account`.
- No migration, no RLS change, no AI model call — CLAUDE.md rules 5–8 don't apply.
- Build plan phase: Polish / post-engine operational hardening, same category as the already-
  archived `account-deletion` change this extends.

## Non-goals

- Not exporting other members' data, story prose/chapters, or anything not personally attributable
  to the requesting user — the story itself is not "their data" any more than it is for deletion.
- Not building a scheduled/background export job — the data volume here does not need one; if a
  future account accumulates enough history that this becomes slow, that's a separate change.
- Not adding export-format options (Markdown/PDF/etc.) — JSON only, matching what a portability
  export is actually for (machine-readable, re-importable), not a formatted document.
- Not integrating this into the account deletion flow itself (e.g., "export before you delete"
  prompt) — that UI nudge is a reasonable follow-up but out of scope here; this change makes the
  capability exist, independent of when or whether a user is about to delete.
