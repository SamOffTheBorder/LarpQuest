## Context

`lib/rate-limit.ts` already has four policies (`sign_in`, `story_create`, `universe_draft_create`,
`turn_generate`, `invite_create`) wired at their respective server actions. `createShareLink`
exists in `share-links.ts` with the same owner/GM role gate as `createInvite`, but has no rate
limit and no UI caller — it was simply never reached by the sweep that added the other four.

## Goals / Non-Goals

**Goals:**
- `createShareLink` gets a rate limit, enforced the same way as every other limited action —
  checked at the server action, not inside the engine function (matching `createInviteAction`'s
  pattern, not `createInvite`'s).
- A UI actually exists to create/revoke share links, since a rate limit with no reachable caller
  protects nothing.

**Non-Goals:**
- No new rate-limiting infrastructure — `check_rate_limit` and `assertWithinRateLimit` are already
  generic across actions.
- No change to token generation, revocation semantics, or the `resolve_share_link` RPC.

## Decisions

**Budget matches `invite_create` exactly (20/hour, keyed by user id).** Both are owner/GM-only
management actions with no legitimate high-frequency use case, and no traffic data exists yet to
justify a different number — same documented caveat every other policy already carries.

**Rate limit lives in the server action, not in `createShareLink` itself.** Matches
`createInviteAction`/`createInvite`'s existing split exactly: the engine function stays a pure
domain operation, the server action is where request-scoped concerns (rate limiting) attach. This
is also why `RateLimitedAction` policies are declared centrally rather than at each engine
function — CLAUDE.md rule 6's discipline, already applied to this exact scenario for the other four
actions.

## Risks / Trade-offs

**[Risk] None material.** This is a same-shaped addition to an already-established pattern with no
new failure modes beyond what the existing four policies already carry (documented fail-open
behavior in `rate-limit.ts`).

## Migration Plan

1. Add the policy entry.
2. Add the UI + server action wiring.
3. No rollback concerns — no persisted state.
