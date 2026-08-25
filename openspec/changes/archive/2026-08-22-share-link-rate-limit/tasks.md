## 1. Rate limit policy

- [x] 1.1 Add `'share_link_create'` to `RateLimitedAction` and a `POLICIES` entry (20/hour) in
      `lib/rate-limit.ts`.

## 2. UI entry point and server action

- [x] 2.1 Added `listShareLinks(storyId, userId)` to `share-links.ts`, owner/GM-gated, following
      `listInvites`' pattern. `ShareLinkRecord` gained a `createdAt` field (the `created_at`
      column already existed on `share_links`, just wasn't selected before).
- [x] 2.2 Added `createShareLinkAction`/`revokeShareLinkAction` to
      `stories/[storyId]/members/actions.ts`, calling `assertWithinRateLimit('share_link_create',
      userId)` before `createShareLink`, matching `createInviteAction`'s pattern.
- [x] 2.3 Added a "Share links" section to the Members page (new `share-link-list.tsx`,
      owner/GM only via the existing `isManager` gate), listing active links with copyable URL
      and revoke, following `InviteForm`/`InviteList`'s pattern.

## 3. Verification

- [x] 3.1 Added `listShareLinks` cases (active-only, owner/gm gated) to `share-links.test.ts`,
      and a `share_link_create` policy-resolution case to `rate-limit.test.ts` (matching how
      every other action is verified there — generically, since `assertWithinRateLimit`'s logic
      is action-agnostic; the RPC-denied/fail-open paths are already covered generically and
      don't need a per-action repeat).
- [x] 3.2 Ran `npm test` (503 passed, +3 from this change), `npm run typecheck`, `npm run build`
      in `apps/web` — all three clean.
