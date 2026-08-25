## Why

LAUNCH_PLAN.md item B1.4 ("serve the documents in-app... and a checkbox at signup recording
acceptance with a timestamp and document version. Unrecorded acceptance is unprovable acceptance")
is a Tier B blocker. `legal/TERMS_OF_SERVICE.md`, `PRIVACY_POLICY.md`, and `ACCEPTABLE_USE.md`
already exist as drafts but are not reachable from the app at all — no route, no footer link, no
acceptance recorded anywhere. This change builds the plumbing (routes, footer, acceptance
recording) independent of finishing the drafts' content — the drafts still have `[BRACKETED]`
fields and `DECISION` notes that only the user can resolve (age floor, legal entity, jurisdiction,
billing model), which is out of scope here per the user's explicit choice to defer that decision.

## What Changes

- Add `/terms`, `/privacy`, `/acceptable-use` routes that render the current content of
  `legal/TERMS_OF_SERVICE.md`, `PRIVACY_POLICY.md`, `ACCEPTABLE_USE.md` respectively, read from
  disk at request time (so editing the draft is the only step needed to update the live page — no
  content duplication into the app).
- Add a small markdown-to-HTML dependency to render them, rather than hand-rolling a parser or
  duplicating content as JSX.
- Add footer links to all three pages, visible on every page.
- **Sign-in flow has no distinct "signup" moment** — `signInWithOtp` creates the account
  server-side, invisibly, the first time an address is used; the sign-in form is the only place
  before that where every account-to-be already passes through. So: add a required checkbox to the
  sign-in form ("I agree to the Terms, Privacy Policy, and Acceptable Use Policy") that gates
  sending the magic link at all — everyone requesting a link, new or returning, re-confirms
  agreement to the current version each time, which is stricter than "recorded once at signup" but
  is what this passwordless flow's actual shape allows without adding a separate account-creation
  step this project has deliberately not built.
- New `legal_acceptances` table recording `email`, which document, its content-hash version, and
  when — written from the sign-in server action after the rate limit check and before the magic
  link is sent. Keyed by email, not `user_id`: no session or account exists yet at the point the
  checkbox is checked, and linking it to a `user_id` later would need a fragile backfill with no
  real benefit — the email itself is a sufficient durable identifier for an audit trail that
  nothing in the UI ever needs to read back.
- Document version is a short hash of the file's own content, computed at read time — not the
  `Last updated:` header, which is still an unfilled `[DATE]` bracket in all three drafts today. A
  content hash needs no bracket to be filled in first, and it changes automatically whenever the
  draft's text changes, so there is no second place to remember to bump.

## Capabilities

### New Capabilities
- `legal-acceptance`: recording a user's acceptance of the current version of each legal document,
  and serving the documents themselves in-app.

### Modified Capabilities
(none)

## Impact

- New migration: `legal_acceptances` table, RLS (a user can read their own acceptance rows; no
  update/delete — this is an audit trail, same append-only shape as `entity_history`/
  `story_reports`).
- New dependency: a small markdown-to-HTML package.
- New routes: `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/acceptable-use/page.tsx`.
- New component: a footer, added to the root layout.
- Modified: `sign-in-form.tsx` (checkbox), `sign-in/actions.ts` (record acceptance before sending
  the link).
- Build plan phase: Polish / post-engine operational hardening, Tier B per LAUNCH_PLAN.md.

## Non-goals

- Not resolving any `[BRACKETED]` field or `DECISION` note in the legal drafts — that is a
  business/personal decision explicitly deferred by the user this session. The pages will render
  the drafts exactly as they currently stand, brackets and all.
- Not building a lawyer-review workflow or DMCA agent registration (B1.3) or CSAM procedure (B2.1)
  — separate LAUNCH_PLAN items.
- Not adding a distinct account-creation/signup flow separate from magic-link sign-in — that would
  be a much larger change to the auth model, out of scope here. The checkbox-on-every-sign-in
  approach is the plumbing that fits the existing flow, not a redesign of it.
- Not retroactively recording acceptance for accounts that already exist before this ships — only
  future sign-ins are gated. A backfill for existing users is a reasonable follow-up but not
  attempted here (there is no reliable way to know what, if anything, an existing account already
  implicitly agreed to).
