---
sidebar_position: 6
title: Phase 5 — Multiplayer
---

# Phase 5 — Multiplayer

**Status:** Implemented
**Spec location:** `openspec/changes/archive/2026-08-19-phase-5-multiplayer/`

Phase 5 is build plan Part 7. Phase 1 gave `story_members.role` its four values at the schema level, but only ever inserted an `owner` row and checked membership, never role — every turn-loop function was open to any member. Phase 5 makes rooms real: a second person can join, roles gate what they can do, entities are claimable, deadlines fire, presence is visible, contradictory submissions resolve by policy, and a handful of safety controls exist for rooms of people who don't know each other.

**Exit criteria:** Five people run a story together across a week without coordinating outside the app.

## What ships

- **Invites** — `story_invites` (token, role, expiry, revocation, use tracking) and `join_story_via_invite`, a security-definer RPC that validates a token and inserts the caller's `story_members` row atomically. The only path onto a story besides being its creator.
- **Role-gated authorization** — `requireRole`/`hasRole`/`isGM` in `membership.ts`; `openTurn` and a manual `lockTurn` now require `owner` or `gm`. A deadline-triggered lock is exempt (it isn't acting on behalf of any one user).
- **Entity claiming** — `entities.controlled_by` is enforced, not just stored. `claimEntity`/`releaseEntity`/`reassignEntity`; a submission targeting a claimed entity requires the caller to be its controller or a GM. Removing a member releases the entities they controlled.
- **Turn deadlines** — `turns.deadline` (present since Phase 1, unused until now) drives a scheduled sweep (`sweepDeadlines`, polled via `/api/worker/deadlines`) that auto-locks a due turn per `stories.turn_config.absent_policy`: `skip`, `ai_plays` (fixed-template placeholder submissions, no model call), or `block`.
- **Realtime presence** — `useStoryPresence`/`useTurnPresence` wrap Supabase Realtime Presence and `postgres_changes`; a pure `computeSubmissionCompleteness` function drives "waiting on N of M." Advisory only — no turn-loop transition depends on it.
- **Conflict resolution** — `stories.conflict_policy` (`narrative_priority` default, `initiative_order`, `gm_ruling`, `both_partially_succeed`) is folded into the Narrator system prompt via a fixed lookup, alongside `content_rating`.
- **Room safety** — a `moderator` model role runs once per turn at lock time over the combined submissions (`moderateTurnSubmissions`); `block` reopens the turn, `flag`/`pass` are recorded on `turns.moderation_status`/`moderation_reason`. `story_reports` plus `reportChapter`/`reportSubmission`/`listReports`. Member removal and invite revocation, both owner/GM only.
- **UI** — `/stories/[storyId]/members` (member list with removal, invite creation/list/revocation, reports — all owner/GM-gated where the capability requires it) and `/invite/[token]` (the invite-link landing page: joins and redirects into the story, or shows a typed error for an expired/revoked/exhausted/invalid token). Claim/release buttons on the entities list. An inline report form under each published chapter.

## What does not ship

A real scheduler invoking `/api/worker/deadlines` — the route exists and is tested, matching the existing extraction/memory worker pattern, but nothing in this repo polls it, same as those two · any change to turn modes, validation/gatekeeping, or the research pipeline — those are Phases 6 and 7.

## Capabilities specified

| Capability | Covers |
|---|---|
| `story-invites` | Invite creation, join, revocation |
| `member-roles` | Role-gated turn/membership actions, spectator read-only |
| `entity-claiming` | Claim/release/reassign, submission-requires-control, release on departure |
| `turn-deadlines` | Deadline-triggered lock per `absent_policy` |
| `realtime-presence` | Online presence, per-turn submission completeness |
| `conflict-resolution` | `stories.conflict_policy` in the Narrator prompt |
| `room-safety` | Content rating in the prompt, moderation pass, reporting |
| `turn-loop` (modified) | Role gates on open/lock, entity-control check on submissions |
| `entity-state` (modified) | Manual edits require control or GM |

## Key design decisions

### Invites are a token row, not a signed JWT

Revocation (build plan 7.5) needs something invalidatable without a blocklist. `join_story_via_invite` is `security definer` so the token validation and the `story_members` insert happen atomically — no window where a client could act on a token it read moments earlier as still valid.

### The deadline sweep has no "system user" to act as

The original task plan assumed a synthetic system identity could call `lockTurn`/`createSubmission` directly. It can't: `submissions.user_id references auth.users`, and there is no such row for "the system." `sweepDeadlines` writes placeholder submissions directly, attributed to each unsubmitted entity's own controller, and calls `lockTurn` using the story's **owner** as the acting identity — always a real member, and `source: 'deadline'` already exempts that path from the manual-lock role check.

### Moderation runs once per turn, at lock time, fails open

`moderateTurnSubmissions` runs after a turn's submissions are frozen and before generation. `callStructured`'s own retry (one retry with the parse error appended, per CLAUDE.md #7) already happens inside the gateway; a `StructuredOutputError` surfacing here means both attempts failed, and the outcome degrades to `flag` rather than blocking the turn — the same "never let a broken auxiliary system stop the core loop" principle the extraction worker follows. `block` is the one verdict that actually stops anything: it reopens the turn rather than letting it proceed to generation.

### Content rating and conflict policy are fixed prompt lookups, never a branch on identity

`turn-modes.ts`'s `FREEFORM.systemPrompt` became a function of `(story: { contentRating, conflictPolicy })`, interpolating two `Record<string, string>` lookup tables keyed by policy value. The lookup key is a story-level policy value the user chose, never the universe, genre, or media type — the same discipline Phase 4 established for `retrieval_bias`. Two stories in completely different universes with the same policy values produce byte-identical instruction text.

### Presence is advisory, computed, and never a dependency of turn-loop correctness

"Waiting on N of M" is a pure function (`computeSubmissionCompleteness`) over already-fetched claimed-entity and submission data — no new table, no write path. Supabase Realtime Presence (ephemeral, client-tracked) handles online/offline. Both hooks wrap channel setup in try/catch and degrade to the last known state rather than throwing if Realtime is unavailable.

## Database objects

Created in Phase 5: `story_invites`, `story_reports`, `is_story_role` (policy helper, mirrors `is_story_owner`), `join_story_via_invite` RPC, `stories.conflict_policy`, `turns.moderation_status`/`moderation_reason`. RLS narrowed: `entities_update` (controller/GM only, once claimed), `story_members_delete` (owner or GM, never the owner row). New model role: `moderator`.

→ [Full data model](/reference/data-model)

## Verifying the phase

- `engine/membership.test.ts` — `requireRole` allows an owner-run GM-less story and rejects insufficient roles the same way it rejects non-members; `removeMember` releases the departing member's entities without touching others', and can never remove the owner
- `engine/invites.test.ts` — creation is owner/GM-gated and schema-rejects `role: 'owner'`; join is idempotent and rejects expired/revoked/exhausted tokens; revocation blocks future joins without affecting existing members
- `engine/entity-claims.test.ts` — claim/release/reassign permission matrix, including a GM overriding an existing claim
- `engine/turns.test.ts` — role gates on open/manual-lock; a deadline-sourced lock bypasses the role check; entity-control enforcement on submissions, including the owner/GM-submits-for-unclaimed-entity case
- `engine/turn-modes.test.ts` — every `content_rating`/`conflict_policy` value produces distinct prompt text; identical policy values produce byte-identical text regardless of story identity
- `engine/deadlines.test.ts` — `skip`/`ai_plays`/`block` behavior; the lock-with-no-submissions guard still applies past a deadline; a turn with no deadline set is untouched
- `moderation/moderate.test.ts` — pass/flag/block pass through; a `StructuredOutputError` after retry degrades to flag; usage recorded on every attempt including failure
- `engine/reports.test.ts` — non-member cannot report; owner/GM-only listing
- `realtime/presence.test.ts` — the completeness computation is pure and directly tested
- `npm test` (288/288 passing), `npm run typecheck`, `npm run build` all pass from `apps/web`; `supabase db advisors --linked` and the RLS coverage test both clean after every migration (only the pre-existing leaked-password-protection warning and the intentional `join_story_via_invite`-callable-by-`authenticated` warning remain)

## Working the phase

```bash
openspec show phase-5-multiplayer
openspec status --change phase-5-multiplayer
openspec validate phase-5-multiplayer
```

→ [Spec workflow](/reference/spec-workflow)
