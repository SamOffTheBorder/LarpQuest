---
sidebar_position: 11
title: Multiplayer
---

# Multiplayer

Rooms, roles, entity claiming, deadlines, presence, conflict resolution, and safety controls — build plan [Part 7](/phases/build-order#phase-5--multiplayer). Everything here layers on top of the Phase 1 turn loop and Phase 1 `story_members.role` column; neither the turn state machine nor the roles themselves are new, only their enforcement.

## Roles and authorization

`story_members.role` (`owner | gm | player | spectator`) existed from Phase 1, but only `owner` was ever inserted and no application code checked it. Phase 5 adds `requireRole(storyId, userId, allowed)` next to the existing `assertMember`/`assertOwner` in `membership.ts` — a small, explicit set of role checks rather than a permissions-matrix abstraction, matching how bounded a four-role, handful-of-gated-actions problem actually is.

Gated:

- `openTurn`, and a **manually** triggered `lockTurn` — `owner` or `gm` only
- Manual entity edits — the entity's controller, or `owner`/`gm`
- Member removal, invite creation/revocation — `owner`/`gm` only; the owner can never be removed

Not gated by role, only by control: submitting an action for a claimed entity requires being that entity's controller (see below), independent of story role — a `player` submits for their own claimed character; a `gm` may submit for any entity, claimed or not.

A `spectator` can read everything a member can read and write nothing.

## Invites

`story_invites` is a token row — `role`, `expires_at`, `revoked_at`, `max_uses`/`use_count` — not a signed, stateless JWT. Revocation (build plan 7.5) needs something invalidatable without a blocklist, and a row is the same choice this schema makes for every other durable grant.

Joining calls `join_story_via_invite(token)`, a `security definer` RPC that validates the token and inserts the caller's `story_members` row in one atomic step — there is no window where a client could act on a token it read a moment earlier as still valid, and no way for a non-owner to insert a `story_members` row any other way. The RPC must run under the caller's own session (it reads `auth.uid()`); calling it through the service-role client would resolve `auth.uid()` to null and silently fail to attribute the join to anyone.

## Entity claiming

`entities.controlled_by` existed in the schema since Phase 1 but was never read or written by application code, and `entities_update`'s RLS policy allowed any story member to edit any entity. Phase 5 makes it real:

- `claimEntity` — claims an unclaimed entity; rejected if already controlled by someone else
- `releaseEntity` — the controller, or a GM, releases a claim
- `reassignEntity` — GM/owner only, may override an existing controller
- A submission targeting a claimed entity requires the caller to be its controller or a GM (`turns.ts`'s `assertCanSubmitForEntity`) — an unclaimed entity remains submittable by any member, so a Phase 1-style solo story with no claiming at all keeps working unchanged
- Removing a member releases every entity they controlled (`controlled_by` set to null) rather than leaving a dangling reference, so a GM can reassign or narrate the character out (build plan 7.4)

RLS mirrors this exactly: `entities_update` now reads `is_story_role(story_id, array['owner','gm']) or controlled_by = auth.uid() or (controlled_by is null and is_story_member(story_id))`.

## Turn deadlines

`turns.deadline` existed since Phase 1's original migration and was never read. `sweepDeadlines()` (`engine/deadlines.ts`, polled via `/api/worker/deadlines`, matching the existing extraction/memory worker pattern — shared-secret auth, no user session) finds `open` turns whose deadline has passed and acts per `stories.turn_config.absent_policy`:

| Policy | Behavior |
|---|---|
| `skip` (default) | Locks with whatever submissions exist |
| `ai_plays` | Writes a fixed-template placeholder submission (`"<name> waits, taking no deliberate action this turn."` — no model call) for every unsubmitted claimed entity, then locks |
| `block` | Leaves the turn open |

Every path funnels through the same `lockTurn` a GM calls manually, via a `source: 'manual' | 'deadline'` option — `'deadline'` skips the role check (the sweep isn't acting on behalf of any one user) but is otherwise identical, including the existing lock-with-no-submissions guard.

There is no synthetic "system" identity in this codebase — `submissions.user_id` and every acting-user parameter reference `auth.users`. Placeholder submissions are attributed to each entity's own controller (a real member), and the deadline-triggered `lockTurn` call uses the story's **owner** as its acting identity, since the owner is always guaranteed to be a member.

## Realtime presence

Purely additive: no turn-loop transition or generation outcome reads presence state. Two concerns, two mechanisms:

- **Online presence** (`useStoryPresence`) — Supabase Realtime's Presence API, ephemeral and client-tracked, no database writes
- **Submission completeness** (`useTurnPresence`) — a `postgres_changes` subscription on `submissions`, feeding a pure function `computeSubmissionCompleteness(claimedEntityIds, submittedEntityIds)` that counts claimed-but-not-yet-submitted entities. An unclaimed entity is excluded from both the numerator and denominator — it's nobody's turn to wait on.

Both hooks wrap channel setup in `try`/`catch` and degrade to the last known (server-rendered) state rather than throwing if Realtime is unavailable.

## Conflict resolution

`stories.conflict_policy` (`narrative_priority` default, `initiative_order`, `gm_ruling`, `both_partially_succeed`) is folded into the Narrator system prompt through a fixed lookup table in `turn-modes.ts` — `FREEFORM.systemPrompt` became a function of `(story: { contentRating, conflictPolicy })` instead of a static string. The lookup key is a policy value the story owner chose, never the universe, genre, or media type, so the engine code itself never branches on story identity — two stories running completely different universes with the same `conflict_policy` value get byte-identical instruction text. This is the exact discipline [Phase 4 established for `retrieval_bias`](/architecture/memory-and-context#retrieval-bias-is-a-prompt-instruction-not-a-ranking-strategy): the differentiated behavior lives entirely in prompt content, not in a code path.

`content_rating` — captured at story creation since Phase 1 but never referenced downstream — is folded into the same prompt via the same mechanism.

## Room safety

### Moderation

A new `moderator` model role runs once per turn, at lock time, over the turn's combined submissions — after they're frozen, before generation. `callStructured` already retries once internally with the parse error appended (CLAUDE.md constraint #7); `moderateTurnSubmissions` catches a `StructuredOutputError` surfacing after that retry is exhausted and degrades to a `flag` outcome rather than throwing — a broken moderator must never leave a turn stuck.

- `pass` — generation proceeds silently
- `flag` — generation proceeds; the verdict and reason are recorded on `turns.moderation_status`/`moderation_reason` for GM review
- `block` — the turn is reopened (`locked` → `open`) rather than proceeding to `generating`; the submitting flow sees a `TurnBlockedByModerationError` naming the reason

### Reporting, removal, revocation

`story_reports` records a report against exactly one chapter or one submission (a check constraint enforces the either/or), filed by any member, visible only to `owner`/`gm`. Member removal and invite revocation are both `owner`/`gm`-gated; removal additionally releases the departing member's claimed entities (see above).

## Genre-agnosticism

Nothing in this phase branches on universe, genre, or media type. The two prompt-shaping lookups (`content_rating`, `conflict_policy`) key on story-level policy values the same way [Phase 4's `retrieval_bias`](/architecture/memory-and-context) does; `genre-agnosticism.test.ts` — the existing Phase 2 structural scanner over all of `lib/engine/` — passes unmodified against `turn-modes.ts`'s new lookup tables, since they contain policy vocabulary (`teen`, `gm_ruling`, ...), not genre or universe fixture identifiers.

→ [Full data model](/reference/data-model)
