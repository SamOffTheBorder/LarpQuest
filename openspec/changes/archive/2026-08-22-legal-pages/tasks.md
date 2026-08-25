## 1. Migration

- [x] 1.1 New migration: `legal_acceptances` table (`id`, `email`, `document` text check-constrained
      to `('terms', 'privacy', 'acceptable_use')`, `version` text, `accepted_at timestamptz default
      now()`). RLS enabled, no policies at all (service-role only — matches the "no client access
      needed" decision in design.md; RLS-enabled-no-policy is intentional here the same way
      `rate_limit_counters` already does it elsewhere in this schema).

## 2. Rendering

- [x] 2.1 Added `marked` (^18) as a markdown-to-HTML dependency.
- [x] 2.2 Added `lib/legal.ts`: `renderLegalDocument(document)` reads a `legal/*.md` file, returns
      `{ html, version }` where `version` is a sha256 hash of the raw file content, truncated to
      12 hex chars (matching the token-length convention already used elsewhere in this codebase).
- [x] 2.3 Added `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/acceptable-use/page.tsx`, each
      rendering its document via a shared `LegalDocumentView` component.
- [x] 2.4 Verified via the dev server: blockquote callouts and DECISION note blocks render
      correctly. Found and fixed a real bug in the process — the drafts cross-link each other with
      relative Markdown paths (`./PRIVACY_POLICY.md`) that don't resolve as in-app routes; added
      `rewriteCrossDocumentLinks` in `lib/legal.ts` to remap them to `/terms`/`/privacy`/
      `/acceptable-use` post-render, without editing the source `.md` files (which should stay
      portable/readable outside the app, e.g. on GitHub).

## 3. Footer

- [x] 3.1 Added `components/app-footer.tsx` with links to `/terms`, `/privacy`, `/acceptable-use`.
- [x] 3.2 Wired into the root layout, visible on every page (the last-resort `global-error.tsx`
      renders its own `<html>`/`<body>` outside the root layout and is out of scope — it does not
      use `AppHeader` either).

## 4. Acceptance recording at sign-in

- [x] 4.1 Added `recordLegalAcceptance(email)` to `lib/legal.ts`: inserts one row per document for
      the given email, using each document's current content-hash version.
- [x] 4.2 Added a required checkbox to `sign-in-form.tsx` linking to all three pages
      (`target="_blank"` so checking it doesn't require losing the in-progress form).
- [x] 4.3 Updated `signInAction`: rejects with a clear message if the checkbox wasn't checked,
      after the rate-limit check and before calling `signInWithOtp`, then calls
      `recordLegalAcceptance`.

## 5. Verification

- [x] 5.1 Added `lib/legal.test.ts` (6 tests: rendering, cross-link rewriting, version stability/
      change, acceptance recording) and `app/sign-in/actions.test.ts` (4 tests: rejects without
      the checkbox, records + sends when checked, invalid email rejected before the checkbox
      check, rate-limited requests never record acceptance).
- [x] 5.2 Ran `npm test` (513 passed, +10 from this change), `npm run typecheck`, `npm run build`
      in `apps/web` — all three clean. New routes `/terms`, `/privacy`, `/acceptable-use`
      registered in the build output.
- [x] 5.3 Pushed the migration; `supabase db advisors --linked` reported no new findings for
      `legal_acceptances`.
