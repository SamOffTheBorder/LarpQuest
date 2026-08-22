---
sidebar_position: 17
---

# Account deletion

Deleting an account in a single-player app just deletes the account's rows.
In a multiplayer one, most of what a user's id touches — a story, its
chapters, other members' submissions — is not theirs alone to take with them.

## Anonymize, not cascade

Of the auth.users foreign keys in the schema, most were already `on delete set
null` from their original migrations: `story_invites.created_by`,
`entities.controlled_by`, `entity_history.applied_by`, `story_reports`,
`proposals.created_by`, turn mode changes, `export_jobs.requested_by`,
`share_links.created_by`. Deleting the account that created any of these
already just orphaned the attribution — the row stayed.

Four did not, and migration `20260824000004` changed them from `cascade` to
`set null`:

| Column | Why cascading was wrong |
| --- | --- |
| `stories.owner_id` | Would delete the whole story — every other member's chapters, entities, and history along with it |
| `submissions.user_id` | CLAUDE.md #4: no generation outcome may delete or alter a submission. Account deletion is not a generation outcome, but the same reasoning applies — another player's turn may be waiting on this submission |
| `universes.owner_id` | A published universe can be cloned or actively pinned by other stories via `universe_version` |
| `universe_drafts.owner_id` | Consistency with the others, even though an in-progress draft is lower stakes |

`api_keys.owner_id` stays `cascade` deliberately — a key with no owner has no
meaning and holds no collaborative value.

`stories_update`/`stories_delete` RLS policies gate on `is_story_owner()`,
which checks `story_members.role = 'owner'`, not `stories.owner_id` — so
orphaning that column cannot change who can manage the story. What actually
matters for access is `story_members`, which still cascades that one user's
own row, correctly.

## The governance gap that created

`story_members` cascading a deleted user's own row is correct — a membership
is meaningless without the member. But if that user was a story's *only*
`owner`, the story is left with no one who can ever manage it: no one can
rename it, change its settings, or delete it, since those are gated on
`is_story_owner()` and nothing currently promotes a replacement.

Two ways to close that gap were considered: auto-promote a successor on the
user's behalf, or require them to hand it off first. Auto-promotion makes a
real decision — who should run someone else's game — without asking, so
deletion is **blocked** instead: `deleteAccount` checks every story the user
sole-owns and refuses with `AccountDeletionBlockedError` naming them, before
touching `auth.admin.deleteUser`.

## Ownership transfer

This made a real feature necessary on its own, not just a workaround:
`transfer_story_ownership` (migration `20260824000005`) is a `security
definer` SQL function, modeled on `join_story_via_invite`, that demotes the
outgoing owner to `gm` — they keep meaningful access to the story they built,
not reduced to a submitter — and promotes the target atomically. A two-step
client-side update (demote, then promote) would have a window where RLS
evaluates `stories_update` against zero owners; one function that checks the
whole invariant before writing anything avoids that.

Reachable from a story's Members page for its current owner.

## What deletion actually does

`deleteAccount(userId)`:

1. Finds every story where this user is the sole owner (`sole-ownership.ts`
   holds the pure decision logic, separate from the query, for the same
   reason `budget.ts` is separate from `spend.ts` — testable without a
   database).
2. Refuses if any exist.
3. Otherwise calls `auth.admin.deleteUser`, which triggers the FK behavior
   above.

The confirmation UI at `/settings/account` requires typing a literal phrase
back rather than a password re-prompt — the action is already behind an
authenticated session, so the friction is there to catch a misclick, not to
re-verify identity.
