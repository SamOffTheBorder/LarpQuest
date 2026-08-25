## Why

LAUNCH_PLAN.md's completed-work notes for the already-archived `rate-limiting` change record this
gap explicitly: "`createShareLink` has no rate limit because it has no live UI entry point yet."
`createShareLink` (`share-links.ts`) still has no caller anywhere in `apps/web/src/app` — no page
or action invokes it. Adding the rate-limit check now, without the UI that would exercise it, would
protect nothing. This change closes the gap the way the other four `rate-limiting` policies were
closed: by wiring the policy at the point where the action actually becomes reachable, which
requires building that missing entry point first.

## What Changes

- Add `share_link_create` to `RateLimitedAction`/`POLICIES` in `lib/rate-limit.ts`, budgeted the
  same way `invite_create` is (both are owner/GM-only, low-frequency management actions): 20 per
  hour, keyed by user id.
- Add the missing UI entry point: a "Create share link" action on the story's Members page
  (owner/GM only, matching `createShareLink`'s own existing role gate), listing existing links with
  revoke, since `listShareLinksForStory`/`revokeShareLink` already exist in `share-links.ts` with no
  UI consumer either.
- Call `assertWithinRateLimit('share_link_create', userId)` inside the new server action before
  `createShareLink`, following the exact pattern `createInviteAction` already uses for
  `invite_create`.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `share-links`: gains a rate limit on link creation and a UI surface to create/revoke links —
  neither changes the existing spec's requirements about token entropy, revocability, or
  visibility, so no requirement text changes; this is implementation-level completion of an
  already-specified capability, not a behavior change to it. (No delta spec file needed — see
  note below.)

## Impact

- Modified: `lib/rate-limit.ts` (new policy entry), `lib/engine/share-links.ts` callers (a new
  server action, not the engine function itself, which keeps its existing signature).
- New: a share-link UI section on `stories/[storyId]/members/page.tsx` (or a dedicated
  sub-component matching `InviteForm`/`InviteList`'s existing pattern).
- No migration — `check_rate_limit` is already a generic, action-parameterized function; only a
  new policy entry and call site are needed, no schema change.
- Build plan phase: Polish / post-engine operational hardening, closing out the last item named in
  the already-archived `rate-limiting` change's own notes.

## Non-goals

- Not changing `createShareLink`/`revokeShareLink`'s existing signatures or role gating.
- Not adding CAPTCHA or other B3.2-scoped abuse resistance — out of scope, tracked separately in
  LAUNCH_PLAN.md.
- Not tuning the rate limit budget against real traffic — none exists yet, matching every other
  policy's own documented caveat.
