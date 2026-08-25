## Context

`legal/*.md` exist as drafts, unreachable from the app. Sign-in is passwordless: `signInAction`
calls `supabase.auth.signInWithOtp`, which silently creates an `auth.users` row the first time an
email is used — there is no separate "create account" step this codebase distinguishes from
"sign in." That shapes everything about where acceptance can be recorded: the sign-in form is the
only point in the flow that runs before a session or account exists, so it is the only point that
can gate *every* account-to-be, not just first-time ones.

## Goals / Non-Goals

**Goals:**
- The three legal documents are reachable at stable URLs, rendered from `legal/*.md` directly (no
  content duplicated into the app).
- Every sign-in (not just the first) records that the requesting email confirmed agreement to the
  current version of all three documents, with a timestamp.
- A later edit to any draft is automatically a new "version" with no manual bump step.

**Non-Goals:**
- No distinct signup flow, no `user_id` linkage on acceptance rows (see Decisions).
- No resolution of the drafts' own `[BRACKETED]`/`DECISION` content — explicitly deferred.
- No enforcement mechanism beyond the checkbox (e.g., blocking existing sessions until they
  re-accept a changed version) — out of scope; this establishes the recording mechanism, not a
  full consent-versioning enforcement system.

## Decisions

**Version = a short hash of the file's own bytes, computed at read time, not a manually maintained
version number or the (currently unfilled) `Last updated:` header.** The three drafts' `Last
updated: [DATE]` fields are literal unresolved brackets today — treating that as the version would
make every acceptance row record version `[DATE]`, which is worse than useless for an audit trail.
A content hash (`crypto.createHash('sha256').update(fileContents).digest('hex').slice(0, 12)`,
matching the length convention already used for tokens elsewhere in this codebase, e.g.
`randomBytes(24).toString('base64url')` in share-links.ts) needs nothing filled in, is stable
across identical content, and changes automatically the moment the draft's text changes — exactly
the "no second place to update" property the proposal wants. Alternative considered: a manually
incremented `TERMS_VERSION = 1` constant per document — rejected because it is exactly the kind of
thing a future edit can forget to bump, which defeats the purpose of an acceptance audit trail.

**Acceptance is keyed by email, not `user_id`.** At the moment the checkbox is checked and
submitted, no session and no `auth.users` row are guaranteed to exist yet — `signInWithOtp` creates
the account server-side as a side effect of the *next* request (clicking the emailed link), not
this one. Recording against `user_id` would require either (a) creating the account synchronously
in the sign-in action before it's otherwise needed, which changes auth behavior for no reason this
change needs, or (b) writing a nullable `user_id` now and backfilling it later from the callback
route by matching on email — a heuristic with real failure modes (email case sensitivity, an
address later changed, multiple pending acceptances for repeat sign-in attempts before the link is
ever clicked) for a linkage nothing in this change actually reads back. Email alone is a complete,
simple, durable answer to "did this address confirm agreement to version X at time Y" — which is
exactly what "unrecorded acceptance is unprovable acceptance" requires. If a future need arises to
query "this specific account's acceptance history," that is a `user_id` backfill worth doing then,
informed by an actual read requirement, not built speculatively now.

**The checkbox gates every sign-in, not just the first.** The alternative — trying to detect "is
this a new account" before an account exists — is not reliably possible with this auth flow without
querying `auth.admin` for the email first (an extra service-role round-trip on every sign-in
attempt, and still racy against concurrent sign-ups). Requiring re-confirmation on every sign-in is
stricter than the letter of "recorded at signup," but satisfies the actual goal (provable,
current-version acceptance) more simply and without extra auth-flow complexity. This is called out
explicitly in the proposal's non-goals as a deliberate trade, not an oversight.

**Rendering: read `legal/*.md` from disk at request time, converted to HTML with a small markdown
package (chosen by the user), not duplicated into JSX or pre-built at compile time.** Editing a
draft is then the only step needed to update the live page — no second copy to keep in sync, which
matters especially now while the drafts are still actively being edited to resolve their bracketed
fields. Alternative considered: MDX compiled at build time — rejected as unnecessary build-pipeline
complexity for three static documents with no interactive content; a plain markdown-to-HTML
conversion at request time is simpler and the pages are not hit often enough to matter for
performance. Server components read the file with Node's `fs`, same as any other server-only file
read in this codebase — these routes are `force-dynamic` in effect (no need for explicit
`export const dynamic`, since reading a file at request time in a Server Component already
prevents static optimization the same way any other uncached read does).

**`legal_acceptances` is append-only, RLS write-only from the service role, no client read
policy.** Nothing in the UI needs to display a user's own acceptance history back to them — this
is an operator-side audit trail, the same shape as `usage_log` from the requesting user's
perspective (written server-side, not read back by the client). If that changes later, a select
policy is a small addition; not needed now, and per RLS discipline (CLAUDE.md rule 5) a table gets
exactly the policies its actual access patterns need, not speculative ones.

## Risks / Trade-offs

**[Risk] Requiring the checkbox on every sign-in is friction for returning users who already
agreed.** → Mitigation: accepted deliberately — see the keying decision above. The alternative
(detecting new vs. returning before an account exists) adds real complexity for a small UX
improvement; friction on an infrequent action (sign-in) is a reasonable trade against "unrecorded
acceptance is unprovable acceptance" being a hard requirement.

**[Risk] Existing accounts created before this ships have no acceptance record at all.** →
Mitigation: explicitly out of scope per the proposal's non-goals — there is no reliable way to
retroactively know what an existing account agreed to, and fabricating a record would be worse
than having none. This becomes moot in practice once the drafts' content is finalized and a lawyer
review happens (LAUNCH_PLAN B1.1/B1.2), at which point re-acceptance of the finalized version is
wanted anyway.

**[Risk] The markdown package could render something unexpected from the drafts' own formatting
(blockquotes, nested lists in the DECISION notes).** → Mitigation: visually verify all three
rendered pages after implementation, specifically the `> **⚠️ NOT LEGAL ADVICE**` blockquote
callouts and the `DECISION` note blocks, which are the most structurally unusual parts of these
documents.

## Migration Plan

1. New migration: `legal_acceptances` table + RLS (service-role insert only).
2. Add the markdown dependency; add three route pages reading from `legal/`.
3. Add a footer component linking all three, wired into the root layout.
4. Add the checkbox to `sign-in-form.tsx` and the write to `sign-in/actions.ts`.
5. No rollback concerns beyond reverting the commit — no data migration, and the new table has no
   downstream dependents yet.

## Open Questions

None — the email-keying and content-hash-versioning decisions above resolve what would otherwise
be open questions, based on what this auth flow's actual shape allows.
