## 1. Database: invites, reports, conflict policy, RLS narrowing

- [x] 1.1 `supabase/migrations/20260820000001_story_invites.sql`: `story_invites` table — `id uuid pk`, `story_id references stories on delete cascade`, `token text not null unique`, `role text not null check (role in ('gm','player','spectator'))`, `created_by uuid references auth.users`, `expires_at timestamptz not null`, `revoked_at timestamptz`, `max_uses int`, `use_count int not null default 0`, `created_at timestamptz not null default now()`. Index on `token`. RLS: select/insert/update restricted to owner/GM via `is_story_role`; no client-side insert path needed for joining (that goes through the RPC in 1.3).
- [x] 1.2 Same migration: `is_story_role(target_story_id uuid, roles text[])` helper function (security definer, mirrors `is_story_owner`'s shape) — `exists (select 1 from story_members where story_id = target_story_id and user_id = auth.uid() and role = any(roles))`. Used by this migration's own policies and by later entity/turn RLS.
- [x] 1.3 Same migration: `join_story_via_invite(p_token text)` RPC, security definer — validates the token (exists, not expired, not revoked, under `max_uses` if set), inserts a `story_members` row for `auth.uid()` with the invite's role if not already a member (no-op if already a member), increments `use_count`. Returns the resulting role. Raises a typed error for expired/revoked/exhausted/not-found tokens.
- [x] 1.4 The RPC is `security definer` so it bypasses `story_members_insert` entirely — confirmed no policy change was needed. Added `20260820000004_harden_invite_functions.sql` instead (not originally scoped): `supabase db advisors` flagged both new security-definer functions as callable by `anon`; revoked execute on `is_story_role` from all three roles (policy-internal helper, same as `is_story_owner`) and on `join_story_via_invite` from `public`/`anon` while keeping it granted to `authenticated`, matching the codebase's existing hardening pattern (`20260813000001_harden_helper_functions.sql`).
- [x] 1.5 `supabase/migrations/20260820000002_story_reports.sql`: `story_reports` table — `id`, `story_id references stories on delete cascade`, `reporter_id uuid references auth.users`, `chapter_id uuid references chapters on delete cascade` (nullable), `submission_id uuid references submissions on delete cascade` (nullable), `reason text not null`, `created_at`. Check constraint: exactly one of `chapter_id`/`submission_id` is non-null. RLS: insert by any `is_story_member`; select by `is_story_role(story_id, array['owner','gm'])`.
- [x] 1.6 Same migration: `stories.conflict_policy text not null default 'narrative_priority' check (conflict_policy in ('narrative_priority','initiative_order','gm_ruling','both_partially_succeed'))`.
- [x] 1.7 `supabase/migrations/20260820000003_entity_control_rls.sql`: narrow `entities_update` policy from "any story member" to `is_story_role(story_id, array['owner','gm']) or controlled_by = auth.uid() or (controlled_by is null and is_story_member(story_id))` (unclaimed entities remain editable by any member so early solo/Phase-1-style stories keep working; once claimed, only the controller or GM can edit).
- [x] 1.8 Same migration: `story_members_delete` policy extended from owner-only to `is_story_owner(story_id) or is_story_role(story_id, array['gm'])`, with an explicit `and role != 'owner'` guard so the owner row can never be deleted via this policy.
- [x] 1.9 `supabase db push --linked`, then `supabase db advisors --linked` and `supabase db query --linked --file supabase/tests/rls_coverage.sql`. Clean (only the pre-existing, unrelated leaked-password-protection warning and the intentional `join_story_via_invite`-callable-by-`authenticated` warning remain — the latter is required for the join flow to work at all). Also added `story_reports` to the RLS coverage test's append-only-tables list.

## 2. Membership: roles, invites, entity claiming (application code)

- [x] 2.1 `apps/web/src/lib/engine/membership.ts`: added `StoryRole`, `isGM(role)`, `hasRole(role, allowed)`, `requireRole(storyId, userId, allowed)` (throws `InsufficientRoleError`, mirrors `NotAMemberError`'s "don't distinguish not-a-member from wrong-role" shape).
- [x] 2.2 `apps/web/src/lib/engine/invites.ts`: `createInvite`/`revokeInvite`/`joinViaInvite`. `joinViaInvite` must run under the session-scoped `createClient()`, not `createServiceRoleClient()` — the RPC reads `auth.uid()`, which resolves to null under a service-role call (caught during implementation, not in the original task description).
- [x] 2.3 `apps/web/src/lib/engine/invites.test.ts`: 10 tests, all passing — creation rejects non-owner/GM and schema-rejects `role: 'owner'`; join succeeds and is idempotent; join rejects expired/revoked/exhausted; revoke blocks future joins without affecting existing members.
- [x] 2.4 `apps/web/src/lib/engine/entity-claims.ts`: `claimEntity`/`releaseEntity`/`reassignEntity`, as scoped.
- [x] 2.5 `apps/web/src/lib/engine/membership.ts`: `removeMember` — role-gated, rejects removing the owner, releases the removed user's entities then deletes the membership row.
- [x] 2.6 `apps/web/src/lib/engine/entity-claims.test.ts` (8 tests) and `apps/web/src/lib/engine/membership.test.ts` (10 tests, new file), all passing. Also regenerated `src/lib/supabase/database.types.ts` (`npm run db:types`) — required for section 1's new tables/RPC to typecheck; `npx tsc --noEmit` clean.

## 3. Turn loop: role gates and entity-ownership check

- [x] 3.1 `apps/web/src/lib/engine/turns.ts`: `openTurn` calls `requireRole(['owner','gm'])` before creating the turn row.
- [x] 3.2 Same file: `lockTurn` gained a `{ source?: 'manual' | 'deadline' }` options param — `'manual'` (default) calls `requireRole(['owner','gm'])`, `'deadline'` calls only `assertMember` (the sweep isn't acting for one user, so it can't hold a role, but it still only fires on a real story).
- [x] 3.3 Same file: `assertCanSubmitForEntity` helper wired into `createSubmission`/`updateSubmission` — rejects when the target entity is claimed by someone other than the caller and the caller isn't owner/gm; unclaimed entities and null `entityId` remain unrestricted.
- [x] 3.4 `apps/web/src/lib/engine/turns.test.ts`: 8 new tests (21 total, all passing) — player blocked from open/manual-lock; deadline-sourced lock bypasses the role check; owner-run GM-less story unaffected; controller/GM/unclaimed-entity submission cases. Existing fixture reworked from a membership `Set` to a `Map` carrying roles (`USER` defaults to `owner`, matching every prior phase's implicit single-user-does-everything assumption) — also added an `open_turn` RPC handler to the fake (previously unexercised, since prior tests always seeded a turn directly) and an `entities` table stub.

## 4. Conflict policy and content rating in the Narrator prompt

- [x] 4.1 `apps/web/src/lib/engine/turn-modes.ts`: `TurnMode.systemPrompt` is now `(story: TurnModeStoryContext) => string`, interpolating `CONTENT_RATING_INSTRUCTIONS`/`CONFLICT_POLICY_INSTRUCTIONS` fixed lookup tables. `turns.ts`'s `buildTurnContext`/`generateTurn` and `baseline.ts`'s comparison generator both updated to select `content_rating`/`conflict_policy` and call `mode.systemPrompt({ contentRating, conflictPolicy })` — two call sites found and fixed, not just the one in the original task description.
- [x] 4.2 `apps/web/src/lib/engine/turn-modes.test.ts` additions (5 new tests): each rating/policy value distinct; two calls with identical policy values produce byte-identical text; an unrecognized value falls back rather than throwing. Existing `mode.systemPrompt.length` assertion updated to call the function first.
- [x] 4.3 `genre-agnosticism.test.ts` already scans all of `lib/engine/` including `turn-modes.ts`; the new lookup tables use policy vocabulary (`teen`, `mature`, `gm_ruling`, ...), not genre/universe fixture identifiers, so it passes unmodified — no targeted addition needed.

## 5. Turn deadlines

- [x] 5.1 `apps/web/src/lib/engine/deadlines.ts`: `sweepDeadlines()` as scoped, with one correction from the original task description — there is no "system user" to act as (`submissions.user_id references auth.users`, `lockTurn`'s `assertMember` needs a real member), so placeholder submissions are inserted directly and attributed to each entity's own controller, and the deadline-triggered `lockTurn` call uses the story's owner as its acting identity (always a real member, and `source: 'deadline'` already exempts it from the role check).
- [x] 5.2 `apps/web/src/app/api/worker/deadlines/route.ts`: route handler invoking `sweepDeadlines()`, mirrors `api/worker/extract/route.ts`'s shared-secret auth and always-200 response shape.
- [x] 5.3 `apps/web/src/lib/engine/deadlines.test.ts`: 6 tests, all passing — the four scoped cases plus "deadline not yet passed" untouched.

## 6. Realtime presence

- [x] 6.1 `apps/web/src/lib/realtime/presence.ts`: `computeSubmissionCompleteness` (pure), `useTurnPresence`/`useStoryPresence` hooks wrapping Supabase Realtime (Presence for online members, `postgres_changes` on `submissions` for live completeness updates). Both hooks wrap channel setup in try/catch so an unavailable Realtime connection degrades to the initial server-rendered snapshot rather than throwing.
- [x] 6.2 Wired into `apps/web/src/app/stories/[storyId]/page.tsx` (fetches `listEntities`, derives `claimedEntityIds`) and `turn-panel.tsx` (online-member badge in the header, "waiting on N of M" text next to the submission count).
- [x] 6.3 `apps/web/src/lib/realtime/presence.test.ts`: 6 tests, all passing — the pure completeness function (5 tests: normal split, unclaimed excluded, zero claimed, everyone submitted, no negative count) plus a test confirming the mocked `createClient` failure the hooks' try/catch is meant to guard against actually throws.

## 7. Room safety: moderation pass and reporting

- [x] 7.1 `apps/web/src/lib/ai/roles.ts`: added `moderator` to `MODEL_ROLES`, defaulted to `anthropic/claude-haiku-4.5`.
- [x] 7.2 `apps/web/src/lib/moderation/schemas.ts`: `moderationResultSchema` as scoped.
- [x] 7.3 `apps/web/src/lib/moderation/moderate.ts`: `moderateTurnSubmissions`. `callStructured` already retries once internally with the parse error appended (confirmed in `gateway.ts` — `MAX_STRUCTURED_ATTEMPTS = 2`), so this module catches `StructuredOutputError` after that retry is exhausted and degrades to `flag` rather than re-implementing a retry loop. Zero submissions short-circuits to `pass` without a model call.
- [x] 7.4 Wired into `turns.ts`'s `lockTurn`, after the lock write succeeds: `block` reopens the turn (status back to `open`) and throws `TurnBlockedByModerationError`; `flag`/`pass` are recorded on new `turns.moderation_status`/`moderation_reason` columns (added via `20260820000005_turn_moderation.sql`, not originally scoped — needed somewhere to persist "the flag for GM review" the proposal requires) and the turn stays locked.
- [x] 7.5 `apps/web/src/lib/moderation/moderate.test.ts`: 6 tests, all passing — pass/flag/block pass through; a `StructuredOutputError` degrades to flag; usage recorded on both success and failure; zero submissions skips the model call.
- [x] 7.6 `apps/web/src/lib/engine/reports.ts`: `reportChapter`/`reportSubmission`/`listReports` as scoped.
- [x] 7.7 `apps/web/src/lib/engine/reports.test.ts`: 8 tests, all passing.

## 8. Docs (Docusaurus)

- [x] 8.1 `docs/docs/phases/phase-5-multiplayer.md`: as scoped.
- [x] 8.2 `docs/docs/architecture/multiplayer.md`: as scoped.
- [x] 8.3 `docs/sidebars.ts`: added both entries.
- [x] 8.4 `docs/docs/phases/build-order.md`: Phase 5 row linked, section marked "Status: implemented," link added to the full spec.
- [x] 8.5 `docs/docs/reference/data-model.md`: as scoped, plus `turns.moderation_status`/`moderation_reason` (not originally scoped, needed for the moderation-pass persistence added in 7.4).
- [x] 8.6 `npm run build` inside `docs/` — one MDX fix needed: a placeholder-submission string containing `{entity}` was parsed as JSX per CLAUDE.md's documented gotcha, changed to `<name>`; one broken-anchor fix (guessed heading slug didn't match `memory-and-context.md`'s actual heading text). Clean after both fixes, no broken links or anchors.

## 8b. UI (added after initial implementation — was engine-complete but not user-reachable)

- [x] 8b.1 `apps/web/src/lib/engine/membership.ts`: added `listMembers`; `apps/web/src/lib/engine/invites.ts`: added `listInvites`, and changed `joinViaInvite`'s return from `InviteRole` to `{ storyId, role }` so the join UI can redirect straight into the story (looked up via the token post-join rather than widening the RPC's return shape).
- [x] 8b.2 `apps/web/src/app/stories/[storyId]/members/` — new page listing members (with remove, owner/GM-gated), invite creation/list/revoke (owner/GM-gated), and reports (owner/GM-gated); linked from the main story page header.
- [x] 8b.3 `apps/web/src/app/invite/[token]/page.tsx` — the invite-link landing page: joins directly server-side and redirects into the story, or shows a typed error card (expired/revoked/exhausted/not-found) with a way back to the user's story list.
- [x] 8b.4 `apps/web/src/app/stories/[storyId]/entities/claim-button.tsx` + `claim-actions.ts` — claim/release wired into the entities list page.
- [x] 8b.5 `apps/web/src/app/stories/[storyId]/report-chapter-button.tsx` + `report-actions.ts` — inline report form under each published chapter.
- [x] 8b.6 `npm run build` and `npm test` (288/288) both clean after the UI additions; two test files (`invites.test.ts`, `exit-criterion.test.ts`) needed their fake `createClient` mocks extended with a `.from('story_invites')` handler to match `joinViaInvite`'s new post-join lookup.

## 9. Verification

- [x] 9.1 From `apps/web`: `npm test` (288/288 passing), `npm run typecheck` (clean via `npx tsc --noEmit`), `npm run build` (compiles, all routes generated including `/api/worker/deadlines`) — all three pass.
- [x] 9.2 `supabase db advisors --linked` and the RLS coverage test re-run after every migration across sections 1 and 7 (5 migrations total this phase) — clean throughout; only the pre-existing leaked-password-protection warning and the intentional `join_story_via_invite`-callable-by-`authenticated` warning remain.
- [x] 9.3 `openspec validate phase-5-multiplayer --strict` passes.
- [x] 9.4 `apps/web/src/lib/engine/exit-criterion.test.ts` (3 tests, all passing): invite → join → claim → role-gated-submission-rejection; a full deadline-triggered lock with a placeholder submission for an absent player plus a passing moderation check; a player blocked from opening a turn themselves. Scoped narrower than the original description (no full generate/publish re-drive) since `turns.test.ts` already covers chapter generation end to end — this test's job is proving the Phase-5-specific coordination mechanism holds together across a realistic multi-person sequence, not re-deriving generation.
