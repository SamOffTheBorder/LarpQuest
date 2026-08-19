## Context

`story_members` (`supabase/migrations/20260812000001_stories_and_members.sql`) already has a `role text not null check (role in ('owner','gm','player','spectator'))` column and RLS helpers `is_story_member`/`is_story_owner`, but Phase 1's own comment says "the owner is the only possible member in Phase 1" — no code path inserts a `gm`, `player`, or `spectator` row, and `story_members_insert` RLS only allows the owner to insert. There is no way for a second human to ever join a story today.

`entities.controlled_by uuid references auth.users on delete set null` (`20260812000002_entities_and_history.sql`) exists but is never read or written in application code, and the `entities_update` RLS policy allows any story member to update any entity.

`turns.deadline` (`20260812000003_turns_and_submissions.sql`) exists in the schema and `database.types.ts`, but nothing sets it, reads it, or acts on it. Turn locking today is exclusively the manual, no-role-check `lockTurn(turnId, userId)` in `apps/web/src/lib/engine/turns.ts`.

`apps/web/src/lib/engine/membership.ts` exposes only `isMember`/`isOwner`/`assertOwner`. Every turn-loop function (`openTurn`, `lockTurn`, `generateTurn`, `createSubmission`) calls only `assertMember` — there is no role-based gate anywhere in application code, even though the DB column already carries the four roles the build plan requires.

No Supabase Realtime usage exists anywhere in `apps/web/src` (checked for `channel(`/`presence`/`realtime`). No `conflict_policy` field exists on `stories`. `content_rating` is captured at story creation (`CONTENT_RATINGS = ['everyone','teen','mature']` in `apps/web/src/lib/engine/content-ratings.ts`) but never referenced by `turn-modes.ts`'s `FREEFORM.systemPrompt`. `apps/web/src/lib/ai/roles.ts`'s `MODEL_ROLES` has no moderation-oriented role.

The turn state machine itself (`turn-state.ts`: `open -> locked -> generating -> {published, failed}`, `failed -> generating`) is complete, genre-agnostic, and out of scope to change — Phase 5 adds role gates and a second trigger for the existing `open -> locked` transition, not new states.

## Goals / Non-Goals

**Goals:**
- Let a second human join a story via an invite link, landing in `story_members` with a real, non-owner role.
- Make the four roles in `story_members.role` actually gate behavior in application code, not just exist as a DB constraint.
- Make `entities.controlled_by` a real, enforced ownership field.
- Activate `turns.deadline` as a genuine auto-lock trigger.
- Add presence/completeness visibility via Supabase Realtime, purely additive to the existing turn loop.
- Give the Narrator prompt a conflict-resolution instruction and a content-rating instruction, both data-driven from story config, never a genre branch.
- Add the minimum safety surface the build plan requires for rooms of strangers: moderation pass, report, remove member, revoke invite.

**Non-Goals:**
- No new turn statuses and no change to `TRANSITIONS` in `turn-state.ts` — deadline auto-lock reuses the existing `open -> locked` edge.
- No validation/gatekeeping engine (Phase 6) — the moderation pass here is a pre-context-assembly content check, not the capability-proposal verdict system Part 5 describes.
- No turn-mode-specific behavior — `conflict_policy` and `content_rating` are threaded into the one existing `freeform` prompt template only.
- No custom presence infrastructure — Supabase Realtime's built-in presence API only, no bespoke heartbeat protocol.

## Decisions

### 1. Invites are tokens in a new `story_invites` table, not signed URLs

A `story_invites` row (`id`, `story_id`, `token` (random, unique, indexed), `role`, `created_by`, `expires_at`, `revoked_at`, `max_uses`/`use_count`) is looked up by token at join time. This mirrors how every other durable, revocable grant in this schema is modeled (a row you can query, expire, and revoke), rather than a stateless signed JWT that can't be revoked without a blocklist. `story_members_insert` RLS is extended with a second clause: allow insert when the inserting request supplies a valid, unexpired, unrevoked token for that story (checked via a `SECURITY DEFINER` RPC `join_story_via_invite(token, user_id)` rather than a raw client insert, so the token's validity is enforced server-side atomically with the membership insert — no window where a client could insert with an already-expired token it read moments earlier).

**Alternative considered:** signed, stateless invite URLs (JWT with story id + role + expiry). Rejected — revocation is a hard requirement (build plan 7.5, "owner can revoke invite links") and a stateless token can't be revoked without a separate blocklist table, which is strictly more moving parts than one invites table.

### 2. Role checks are a small helper set added to `membership.ts`, not a permissions matrix table

`isGM(role)`, `hasRole(role, allowed[])`, and `requireRole(supabase, storyId, userId, allowed[])` (throwing, mirroring `assertOwner`'s existing shape) are added next to the existing `isMember`/`isOwner`. Call sites that need "owner or GM" pass `['owner','gm']`. This is a direct extension of the existing, already-proven `assertOwner` pattern rather than introducing a new permissions-matrix abstraction (e.g., a `permissions` table mapping role × action) that nothing in the build plan asks for and that Phase 1–4 never needed for its two-role (owner/nobody) reality.

**Alternative considered:** a declarative permissions matrix (role → allowed actions) stored in config or DB. Rejected — four roles and a handful of gated actions is small enough that inline `requireRole` calls at each call site are more legible than an indirection layer, and it matches the codebase's existing preference (see `turn-state.ts`'s explicit `TRANSITIONS` table) for readable, explicit code over generic engines where the problem is this bounded.

### 3. `openTurn`/`lockTurn` require `owner` or `gm`; `createSubmission` requires the submitting user to control the entity

Per build plan 7.1 ("GM: Open/close turns... Player: Claim entities, submit actions"), `openTurn` and the manual path of `lockTurn` gain `requireRole(['owner','gm'])`. `createSubmission` gains a check: the `entity_id`'s `controlled_by` must equal the calling user (or the caller is `owner`/`gm`, who may submit on behalf of an unclaimed or absent-player entity per 7.4's "GM-controlled" fallback). Owner-run, GM-less stories (7.1: "Owner can run GM-less") keep working unchanged because `owner` is always in the allowed set.

**Alternative considered:** gate only at the RLS layer, leave application code role-blind. Rejected — RLS can enforce row-level access but the build plan's behaviors (deadline-triggered auto-lock choosing an absent-policy, GM submitting for an unclaimed entity) are business logic that has to run in the application layer regardless; RLS alone can't express "or the caller is GM."

### 4. Deadline auto-lock is a scheduled sweep calling the existing `lockTurn` path, not a DB trigger

A new scheduled function (`apps/web/src/app/api/worker/deadlines/route.ts`, invoked the same way as the existing extraction/memory worker routes — shared-secret auth, polled by an external scheduler) finds `open` turns whose `deadline` has passed and, per `stories.turn_config.absent_policy` (`skip | ai_plays | block`), either locks the turn immediately (`skip` — the turn locks with whatever submissions exist; entities without a submission are simply absent from the Narrator's input), synthesizes a minimal "the character does nothing/waits" submission for unsubmitted claimed entities before locking (`ai_plays`), or leaves the turn open and does nothing (`block` — deadline has no effect, matching "block" meaning "do not proceed without everyone"). All three paths funnel through the same `lockTurn` function GMs already use manually, so there is exactly one code path that transitions `open -> locked`.

**Alternative considered:** a Postgres `pg_cron` job calling an RPC directly in the database. Rejected — every other async/scheduled concern in this codebase (extraction, memory) is an application-layer worker route polled externally, and `absent_policy: ai_plays` needs a model call (synthesizing a placeholder submission), which belongs in application code with the rest of the AI gateway usage, not in a DB function.

### 5. Presence is view-only, computed from `submissions` + Realtime presence state, not a new persisted table

"Waiting on 2 of 5" is computed by comparing claimed, non-GM-controlled entities against `submissions` rows for the current open turn — no new table. Supabase Realtime's Presence API (ephemeral, client-tracked, not persisted) handles "who's online in this story right now." A new `apps/web/src/lib/realtime/presence.ts` wraps channel creation/subscription (`story:{storyId}:presence`, `story:{storyId}:turn:{turnId}`) with typed payloads, called from client components only — no server-side dependency on Realtime, so the turn loop's correctness never depends on a websocket being connected.

**Alternative considered:** a `turn_presence` table updated via heartbeat writes. Rejected — Supabase Realtime Presence exists precisely to avoid this (ephemeral, no DB writes per heartbeat, no cleanup-of-stale-rows problem), and the build plan names Supabase Realtime explicitly (8.1) for exactly this purpose.

### 6. `conflict_policy` lives on `stories`, expressed only as a prompt instruction

`stories.conflict_policy text not null default 'narrative_priority' check (... in ('narrative_priority','initiative_order','gm_ruling','both_partially_succeed'))`, set at story creation alongside `content_rating` and `turn_config`. `turn-modes.ts`'s `FREEFORM.systemPrompt` becomes a function of `(story)` instead of a static string, interpolating a short, fixed instruction block keyed by `conflict_policy` value (four fixed strings, not four code paths) plus `content_rating` (three fixed strings). This is the same pattern Phase 4 used for `retrieval_bias` (design decision 4 in that phase): the branch is a lookup into fixed prompt text, never a conditional that inspects genre or universe identity, so CLAUDE.md's non-negotiable #1 stays satisfied — the lookup key is a story-level policy value, not a universe/genre/media-type identity.

**Alternative considered:** a real conflict-resolution algorithm in code (e.g., `initiative_order` sorts submissions and resolves first-come-first-served in code, bypassing the model for that policy). Rejected — the build plan's own framing ("the Narrator must resolve... provide the resolution policy in the prompt") is explicit that this is a prompting concern, and per-policy code branches would be exactly the kind of conditional the engine is built to avoid.

### 7. Moderation is a new `moderator` model role run synchronously before context assembly, blocking generation on rejection

A submission is checked by the `moderator` role (added to `apps/web/src/lib/ai/roles.ts`'s `MODEL_ROLES`, Zod-parsed structured output `{verdict: 'pass'|'flag'|'block', reason}`) at `lockTurn` time, after submissions are frozen but before `generateTurn` proceeds. `block` prevents the turn from proceeding to `generating` (returned to the submitter as an error naming the reason) with the turn returning to `open`, so a rejected submission never reaches a shared room. `flag` allows generation to continue but records the flag on the submission for GM review — a milder signal than the block case. This runs once per turn (over the turn's combined submissions), not once per model call, keeping cost bounded and matching that the safety concern here is "content another player didn't consent to" (per-turn, shared-room content), not per-model-call output filtering.

**Alternative considered:** moderate the generated chapter after the fact instead of the submission before. Rejected — build plan 7.5 explicitly asks for a "submission-level moderation pass before content reaches other players," i.e., gating what goes into the shared prompt, not just what comes out; post-hoc moderation would mean an already-generated, possibly-billed chapter gets discarded, which is more expensive and doesn't stop the offending intent from having shaped the Narrator's output in the first place.

**Failure behavior:** a moderator call that errors or returns unparseable output is treated as `flag` (fail open to generation, not fail closed to a stuck turn) with the error recorded — consistent with "never let a broken auxiliary system block the core loop" (the same principle CLAUDE.md states for extraction), while still surfacing the failure for GM visibility. One retry with the parse error appended before falling back to `flag`, per CLAUDE.md constraint #7.

### 8. Member removal clears `controlled_by`; it does not delete history or submissions

Removing a member (`story_members` delete, owner/GM only) sets any entities they controlled to `controlled_by = null` (already the column's `on delete set null` behavior for user deletion, but membership removal is a separate, softer event — the user account isn't deleted, just removed from this story) so the entity becomes unclaimed for a GM to reassign or narrate out, per build plan 7.4. Past `submissions` and `entity_history` rows keep their `user_id`/`applied_by` foreign keys untouched — removal is a membership change, not a retroactive edit to history (matching CLAUDE.md constraint #3, append-only).

## Risks / Trade-offs

- **[Risk] Invite RPC (`join_story_via_invite`) is a new `SECURITY DEFINER` surface** — any bug here bypasses normal RLS. → Mitigation: the RPC does exactly one thing (validate token, insert one `story_members` row with the token's role, increment `use_count`), reviewed against `supabase db advisors --linked` like every other migration, no dynamic SQL.
- **[Risk] Deadline sweep is polled by an external scheduler** (no scheduler exists in this repo yet, matching how extraction/memory workers are already polled) — if nothing calls the route, `ai_plays`/`skip` deadlines silently never fire. → Mitigation: matches the existing, already-accepted operational model for the other two worker routes; documented as an infra dependency, not hidden.
- **[Risk] Moderation adds one more model call (and latency) to every turn's lock-to-generate path.** → Mitigation: uses a fast/cheap model role resolution (role table lets a story's `model_config` pick a cheap model for `moderator`, same mechanism as every other role); fail-open behavior (decision 7) means a moderator outage degrades to no moderation rather than a stuck story.
- **[Risk] Realtime presence has no server-side source of truth** — a client that disconnects uncleanly can show as "online" briefly. → Mitigation: acceptable per Realtime Presence's own documented behavior (timeout-based cleanup); the turn loop's actual correctness (locking, generation) never reads presence state, so a stale presence indicator is cosmetic only.
- **[Risk] `both_partially_succeed`/`initiative_order` conflict policies are pure prompt instructions with no code-level guarantee the model actually follows them.** → Mitigation: same accepted trade-off as Phase 4's `retrieval_bias` (design decision 4 there) — keeps the engine genre/policy-agnostic in code at the cost of a softer behavioral guarantee; revisit only if real usage shows the model ignoring the instruction.

## Migration Plan

1. New migration: `story_invites` table + RLS (readable by story owner/GM; insert restricted to owner/GM via a function, not direct client insert) + `join_story_via_invite(token, user_id)` RPC; `story_members_insert` policy updated to also allow the RPC's service-role path; `entities_update` RLS narrowed to controller-or-GM-or-owner; `stories.conflict_policy` column with default; `story_reports` table + RLS (insert by any member, select by owner/GM).
2. Second migration (if needed after RLS review): any helper RPC for atomic deadline-triggered locking, if `lockTurn`'s existing logic can't be safely called from a worker route without one.
3. `supabase db push` against the linked project, then `supabase db advisors --linked` and the RLS coverage test, per CLAUDE.md, after each migration.
4. No destructive changes — `controlled_by` and `deadline` already exist as nullable columns; this phase only starts enforcing/reading them.

## Open Questions

- Whether `ai_plays` absent-policy submissions should be attributed to a real model role call (cost/usage_log entry) or a fixed "the character waits" template with no model call — leaning toward a fixed template for the common case (cheaper, deterministic) with tasks.md picking this unless there's a reason a model-generated placeholder matters more.
- Exact invite link expiry default (build plan doesn't specify) — tasks.md will default to 7 days, configurable per invite, unless there's a reason to differ.
