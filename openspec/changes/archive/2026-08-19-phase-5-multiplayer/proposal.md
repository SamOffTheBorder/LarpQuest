## Why

Every story today runs as a solo loop: `story_members` only ever gets an `owner` row, any member can call any turn function with no role check, `entities.controlled_by` is written by the schema but never read, and there is no way for a second human to join a story at all. Phase 4 (Memory) is complete and archived. Part 10 of the build plan puts Multiplayer next: rooms need real membership beyond the owner, roles need to actually gate what a user can do, entities need to be claimable, turns need deadlines and presence, conflicting submissions need a resolution policy, and a shared room between people who don't know each other needs baseline safety controls. This is Part 7 of `STORYFORGE_BUILD_PLAN.md`.

## What Changes

- **Invites**: an owner/GM can generate a revocable, expiring invite link (token-based) that lets a new user join a story as a given role. Joining inserts a `story_members` row — the only path onto a story besides being its creator, since today only the owner can ever be inserted.
- **Role-gated authorization**: add `isGM`/`hasRole`/`requireRole` helpers alongside the existing `isMember`/`isOwner`, and gate the turn-loop functions that the build plan reserves for GM/owner (`openTurn`, `lockTurn`, overriding validation, inviting, removing members) so a `player` can no longer call them. `spectator` gains read-only access enforced at the RLS layer.
- **Entity claiming**: a player claims an unclaimed entity (writes `controlled_by`), and only the claiming user (or a GM) may submit on that entity's behalf going forward — `createSubmission` currently accepts any member for any entity; this closes that gap. A player leaving or an entity's controller being removed clears `controlled_by` (GM-controlled or written out, per 7.4) rather than leaving a dangling reference.
- **Turn deadlines**: activate the already-existing but unused `turns.deadline` column — a scheduled sweep auto-locks a turn whose deadline has passed (matching `absent_policy`: skip / AI-plays-them / block), reusing the existing `open -> locked` transition rather than adding a new turn status.
- **Realtime presence**: a Supabase Realtime channel per open turn reporting which claimed entities have and haven't submitted ("waiting on 2 of 5"), and story-level online/offline presence. Purely additive UI/data-layer — the turn state machine itself does not change.
- **Conflict resolution policy**: add `stories.conflict_policy` (`narrative_priority | initiative_order | gm_ruling | both_partially_succeed`, default `narrative_priority`) and thread it into the Narrator system prompt so contradictory submissions in the same turn are resolved by instruction to the model, not by silently picking one.
- **Safety controls**: `content_rating` (already stored, currently unused downstream) gets wired into the Narrator system prompt; add a lightweight moderation pass over submissions before they reach context assembly, using a new `moderator` model role; add member removal and invite revocation (owner/GM only); add a per-story report mechanism for a submission or a chapter.

## Capabilities

### New Capabilities
- `story-invites`: invite link/token generation, expiry, revocation, and the join flow that inserts a `story_members` row for a non-owner user.
- `member-roles`: application-level role authorization (`isGM`, `hasRole`, `requireRole`) gating GM/owner-only turn-loop and membership actions; spectator read-only enforcement.
- `entity-claiming`: claim/release of `entities.controlled_by`, and enforcement that only the controlling user or a GM can submit for a claimed entity; reassignment on member departure.
- `turn-deadlines`: scheduled deadline enforcement on `turns.deadline` with a configurable absent-player policy, auto-transitioning `open -> locked`.
- `realtime-presence`: Supabase Realtime channels for per-turn submission-completeness ("waiting on N of M") and story-level online presence.
- `conflict-resolution`: `stories.conflict_policy` and its use in the Narrator prompt when a turn's submissions contradict each other.
- `room-safety`: content-rating enforcement in the Narrator prompt, a pre-context-assembly moderation pass (`moderator` role) over submissions, member removal, invite revocation, and per-story reporting of a submission or chapter.

### Modified Capabilities
- `turn-loop`: `openTurn`/`lockTurn` gain role checks (GM or owner only); `lockTurn` gains an automatic deadline-triggered path in addition to the existing all-submitted path; `createSubmission` gains an entity-ownership check.
- `entity-state`: `controlled_by` becomes a real, enforced field instead of schema-only; entity update RLS narrows from "any member" to "controller or GM."

## Non-goals

- No turn-mode work (`action`/`scene`/`investigation`/`dialogue`/`montage`/`freeform` beyond the existing `freeform`) — that is Phase 7.
- No validation/gatekeeping engine (capability proposals, verdicts, canon exceptions) — that is Phase 6. `conflict_policy` here only shapes the Narrator prompt; it is not a validation rule.
- No billing/spend-cap UI changes — `api_keys`/`usage_log` are untouched this phase.
- No change to `assembleContext`'s signature or Phase 4's memory/retrieval pipeline.
- No custom WebSocket infrastructure — presence and turn-state notifications use Supabase Realtime only, per Part 8.1.
- No conditional branching on genre, universe, or media type in any new or modified engine code — roles, claiming, deadlines, presence, and conflict resolution are the same code path for every story regardless of what universe it runs.

## Impact

- **Schema**: new migration(s) adding `story_invites` (token, role, expires_at, revoked_at, created_by), `story_reports` (reporter, target chapter/submission, reason, created_at), `stories.conflict_policy text`, RLS updates on `entities` (controller/GM update) and `story_members` (invite-driven insert instead of owner-only), and activation of `turns.deadline` via a new scheduled function/RPC.
- **Code**: `apps/web/src/lib/engine/membership.ts` (new role helpers), a new `apps/web/src/lib/engine/invites.ts`, a new `apps/web/src/lib/engine/entity-claims.ts`, `apps/web/src/lib/engine/turns.ts` (role gates, deadline auto-lock, entity-ownership check on submission), a new `apps/web/src/lib/realtime/` module for presence channels, `apps/web/src/lib/ai/roles.ts` (new `moderator` role), `apps/web/src/lib/engine/turn-modes.ts` (content-rating and conflict-policy prompt wiring).
- **Model roles**: first use of a `moderator` role for the submission-level moderation pass.
- **Docs**: new `docs/docs/architecture/multiplayer.md`, `docs/docs/phases/phase-5-multiplayer.md`, sidebar and data-model/build-order updates.
