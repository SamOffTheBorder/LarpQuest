## 1. Engine

- [x] 1.1 Add `lib/engine/account-export.ts` with `requestAccountExport(userId)`, aggregating
      under the service-role client: `profiles` (username), `user_preferences`, `story_members`
      (story id/title, role, joined_at — join to `stories` for title), `submissions` (content,
      story_id, turn_id, submitted_at), `story_reports` (as reporter), `usage_log` (as user_id),
      `api_keys` (label, scope, story_id, created_at — never `encrypted_key`).
- [x] 1.2 Handle a user with no history in any table gracefully — return empty arrays, not an
      error.

## 2. Route and UI

- [x] 2.1 Add `app/settings/account/export/route.ts`: `requireUser()`, call
      `requestAccountExport`, return JSON with `Content-Disposition: attachment;
      filename="account-export.json"`.
- [x] 2.2 Add a download link/button on `/settings/account` next to the existing delete-account
      section, with copy clarifying this is a copy of their data, not a backup/restore mechanism.

## 3. Verification

- [x] 3.1 Add `lib/engine/account-export.test.ts`: covers a user with data in every category, a
      user with none, and confirms another member's submissions/identity and the encrypted key
      ciphertext are absent from the result. (4 tests, all pass.)
- [x] 3.2 Ran `npm test` (500 passed, +4 from this change), `npm run typecheck`, `npm run build`
      in `apps/web` — all three clean. New route `/settings/account/export` registered in the
      build output.
