# LarpQuest — Launch Plan

**From "the engine works" to "a website people can actually use."**

Status date: 2026-08-20, revised 2026-08-22. Companion to
`STORYFORGE_BUILD_PLAN.md`, which remains authoritative for engine
architecture. This document covers everything the build plan deliberately left
out: operations, accounts, safety, money, and law.

**Progress since the 08-20 audit** (see `## Completed` at the end for detail):
items 1–5 of Part 6's "this week" list are done except monitoring, and spend
caps (A2.1) are implemented. What remains blocking for Tier A is monitoring,
SMTP, a backup-restore drill, the landing page, and end-to-end verification on
deployed infrastructure — which cannot be done from this repo alone.

---

## Part 0: Where You Actually Are

Verified 2026-08-20 against the working tree:

| Check | Result |
|---|---|
| `npm test` | **437 tests passing**, 55 files |
| `npm run typecheck` | **clean** |
| `npm run build` | **clean**, 25 routes |
| Build plan phases 1–8 | **all archived** in `openspec/changes/archive/` |
| Migrations | 37 applied, RLS throughout |

**This is a real, working engine.** The turn loop, universe research pipeline,
memory/retrieval, multiplayer roles, validation, gatekeeping, all six turn
modes, export, search, and the marketplace all exist and are tested.

What is missing is not engine work. It is the layer that turns an engine into a
service: it must run unattended, survive strangers, not bankrupt you, and not
expose you legally.

### The four things that will actually stop you

Found by inspection, in order of severity:

**1. No scheduler — the turn loop stalls in production.** ⛔
Three worker routes exist and correctly require a bearer token
([extract](apps/web/src/app/api/worker/extract/route.ts),
[memory](apps/web/src/app/api/worker/memory/route.ts),
[deadlines](apps/web/src/app/api/worker/deadlines/route.ts)). Each says it is
"called by a scheduled trigger (cron)". **There is no `vercel.json` and no cron
configuration anywhere in the repo.** Deploy today and: state extraction never
runs, chapter summaries and embeddings are never generated (so memory retrieval
degrades to nothing), and turn deadlines never fire. The app appears to work,
then silently rots. This is a one-hour fix and it is the single highest-priority
item in this document.

**2. No spend caps — unbounded financial liability.** ⛔
`usage_log` records cost *after* each call ([usage.ts](apps/web/src/lib/ai/usage.ts)),
and cost is displayed. But **nothing checks a budget before spending.** Build
plan §8.3 requires "per-story and per-user spend caps with hard stop." Combined
with item 3, one user in a loop can spend your money without limit. If you are
paying for generation, do not open signups without this.

**3. `api_keys` table is unused — BYOK does not exist.** ⛔
The table was created in migration `20260812000006` but **no application code
reads or writes it** (only the generated types reference it). Every call uses
the single server `OPENROUTER_API_KEY` — meaning *you* pay for everything every
user does. Build plan §8.3's two modes (Owner Pays / BYOK) are unimplemented.
For a friends launch, BYOK is the cheapest path to safety.

**4. No account deletion.** ⛔
No deletion path exists. Your Privacy Policy cannot honestly promise deletion
rights until one does, and GDPR/CCPA make this a legal obligation, not a
feature. Note the real design tension: a cascade delete would destroy other
members' story history, and `entity_history` is append-only by design.
**Anonymization, not deletion, is the right resolution** — see Track C.

### Also missing, lower severity

- **No rate limiting anywhere.** No protection on sign-in, generation, or
  research. Research runs are 5–15 minutes of expensive model calls.
- **No CI.** No `.github/` directory. Nothing enforces the three green checks.
- **No error boundaries or 404 page.** No `error.tsx`, `not-found.tsx`, or
  `loading.tsx` anywhere in `src/app`. Any thrown error shows the raw Next.js
  error screen.
- **No landing page.** [page.tsx](apps/web/src/app/page.tsx) is a 9-line
  redirect. Nobody who is not already a user can learn what this is.
- **No monitoring.** No error tracking, no uptime checks, no alerting.
- **No backup verification.** Supabase takes backups; nobody has tested a
  restore.

---

## Part 1: Three Launch Tiers

Do not build for "customers" before "friends" works. Each tier is a real
milestone with a real gate.

| Tier | Audience | Gate |
|---|---|---|
| **A — Friends** | ~5–10 people you know | Runs unattended for two weeks; costs bounded |
| **B — Public beta** | Strangers, free | Safety + legal + abuse resistance |
| **C — Commercial** | Paying customers | Money, support, reliability commitments |

**Recommendation: get to Tier A, then run a real story with your friends for
several weeks before touching Tier B.** That campaign will teach you more about
what to build than any amount of planning. The build plan's own Appendix B
makes the same argument.

---

## Part 2: Tier A — Playable With Friends

**Goal: you and your friends run a real multi-week campaign without you
babysitting the server.**

### Track A1 — Make it run unattended ⛔ BLOCKING

**A1.1 — Configure the scheduler.**
Create `vercel.json` with cron entries hitting the three worker routes. Vercel
Cron sends `Authorization: Bearer $CRON_SECRET`; the routes expect
`WORKER_SECRET`, so either align the names or read both. Suggested cadence:
extraction and memory every minute or two, deadlines every five.

*Caveat:* Vercel Hobby plan allows only a limited number of cron jobs at
once-per-day granularity. **You will likely need the Pro plan ($20/mo) for
minute-level crons**, or an external scheduler (GitHub Actions on a schedule,
cron-job.org, Upstash QStash) hitting the endpoints. Decide this now — it is a
real constraint, not a detail.

**A1.2 — Verify the whole loop end to end on deployed infrastructure.**
Locally, workers may have been invoked by hand. Confirm on the real deployment:
submit → lock → generate → publish → extraction runs → entity state updates →
summary and embedding written → next turn opens. Confirm a missed deadline
actually locks a turn.

**A1.3 — Verify Inngest in production.** The research pipeline is
Inngest-orchestrated. Locally it auto-discovers a dev server with no keys.
Production needs `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` and a registered
app URL. Run one real research job on the deployment before trusting it.

**A1.4 — Stale-claim recovery under real conditions.** `extraction_queue` has
stale-claim recovery. Confirm a worker killed mid-extraction releases its claim
and the row is retried, rather than being stuck claimed forever.

### Track A2 — Bound the money ⛔ BLOCKING

**A2.1 — Implement spend caps with a hard stop.** Build plan §8.3. Before any
model call, check spend against a per-story and per-user cap; refuse and surface
a clear message when exceeded. Put the check in the gateway
([gateway.ts](apps/web/src/lib/ai/gateway.ts)) so no call site can bypass it —
the same discipline CLAUDE.md rule 6 applies to model resolution.

Design note: `usage_log` is written *after* a call, so a naive
sum-then-compare races under concurrency. Either accept slight overshoot (fine
for a friends launch — document it) or reserve budget before the call. Do not
pretend it is exact; the Terms already say caps are a convenience, not a
guarantee.

**A2.2 — Set a hard cap at the provider.** Independent of your code, set a
monthly spend limit on the OpenRouter account. This is your real backstop, and
it works even if your own cap logic has a bug. **Do this first — it takes two
minutes.**

**A2.3 — Cost alerting.** Email yourself when a story or the account crosses a
threshold. A surprise bill discovered at month end is the failure mode to avoid.

**A2.4 — Decide who pays.** For friends, the two sane options: you pay with
caps (simple, you eat cost), or implement BYOK (Track C3) so each person brings
their own key. Choose deliberately; this choice flows into your Terms §10.

### Track A3 — Basic resilience

**A3.1 — Error boundaries.** Add `error.tsx` at the app root and around the
story routes, plus a `not-found.tsx` and `loading.tsx` for the slow
generate/research paths. Currently any error shows the raw Next.js screen.

**A3.2 — Error tracking.** Add Sentry (or equivalent). You cannot fix what your
friends do not report, and they will not report most of it.

**A3.3 — Uptime check.** A free monitor pinging the app and alerting you. Ten
minutes to set up.

**A3.4 — Verify a backup restore.** Confirm Supabase backups are enabled for
your plan, then **actually restore one to a scratch project.** An untested
backup is not a backup. Note the free tier's retention is short — check what you
have.

**A3.5 — CI.** A GitHub Actions workflow running `npm test`, `npm run
typecheck`, and `npm run build` on every push. You already keep all three green;
this stops that from silently regressing.

### Track A4 — Minimum usability for humans who are not you

**A4.1 — A real landing page.** Replace the 9-line redirect. Explain what
LarpQuest is, show an example chapter, and link sign-in. Even your friends need
to know what they are signing into — and this becomes the marketing page later.

**A4.2 — Onboarding for a first story.** The path from empty account to first
chapter crosses universe creation (or marketplace clone), story creation, entity
creation, and turn submission. Walk a friend through it while watching, and fix
what makes them ask a question.

**A4.3 — In-app help for the turn loop.** Roles, deadlines, and what "locked"
means need explanation at the point of use.

**A4.4 — Mobile pass.** Phase 8 included responsive work. Verify on a real phone
— players will submit turns from bed.

**A4.5 — Email deliverability.** Magic links are the only way in. Supabase's
built-in email sender is **rate-limited and not for production** — configure a
real SMTP provider (Resend, Postmark, SES) and confirm SPF/DKIM, or sign-in
links will land in spam and your friends will be locked out.

### Tier A exit criteria

- [ ] A story runs a full week with no manual intervention
- [ ] Extraction, memory, and deadlines demonstrably fire on schedule
- [ ] Total spend for the week is known, bounded, and unsurprising
- [ ] A friend created their own story without asking you how
- [ ] You restored a backup successfully at least once

---

## Part 3: Tier B — Public Beta (Strangers, Free)

Everything in Tier A, plus: strangers are adversarial, sometimes malicious, and
occasionally in crisis.

### Track B1 — Legal ⛔ BLOCKING

Drafts are written and live in [legal/](legal/):

- [Terms of Service](legal/TERMS_OF_SERVICE.md)
- [Privacy Policy](legal/PRIVACY_POLICY.md)
- [Acceptable Use Policy](legal/ACCEPTABLE_USE.md)

**These are drafts by an AI assistant, not legal advice, and are not reviewed by
a lawyer.** They are grounded in how the code actually behaves, so a lawyer can
work from them cheaply rather than starting blank.

**B1.1 — Fill in every bracket and resolve every DECISION note.** Both documents
are full of them. The consequential ones:

| Decision | Note |
|---|---|
| Minimum age | 13 / 16 / 18. Interacts with COPPA, GDPR Art. 8, and your content ratings. Recommend 16+ floor, 18+ for mature stories |
| Legal entity | Sole proprietor vs. LLC. An LLC is the usual answer before taking money from strangers |
| Jurisdiction | Your actual location. Drives governing law and dispute resolution |
| Billing model | BYOK / you pay / free. Changes Terms §10 substantially |
| Deletion semantics | Anonymize vs. delete. **Recommend anonymize** — see C1 |
| Training on content | Draft says no. Recommend keeping it |

**B1.2 — Have a lawyer review before public signups.** A few hours of a
tech/privacy attorney's time. The IP exposure in §6 of the Terms — a research
pipeline explicitly designed to ingest existing franchises — is the part most
worth professional eyes.

**B1.3 — Register a DMCA agent** with the US Copyright Office (~$6). Publishing
an address without registering does **not** grant safe harbor.

**B1.4 — Serve the documents in-app.** `/terms`, `/privacy`, `/acceptable-use`,
footer links, and a checkbox at signup recording acceptance **with a timestamp
and document version**. Unrecorded acceptance is unprovable acceptance.

**B1.5 — Provider DPAs.** Accept/sign Data Processing Agreements with Supabase,
Vercel, Inngest, your email provider, and OpenRouter. Confirm and document
OpenRouter's downstream routing, retention, and training policies — the Privacy
Policy makes claims here that must be true. Enable no-training/zero-retention
flags where offered.

**B1.6 — Pick your regions deliberately.** Supabase and Vercel let you choose.
This determines your international-transfer story.

### Track B2 — Safety ⛔ BLOCKING

**B2.1 — CSAM procedure.** The highest-severity operational risk. You need,
before launch: a documented escalation path, a named responsible person, a
preservation practice (do not delete evidence before reporting), and a
registered NCMEC reporting account. US providers have mandatory reporting duties
under 18 U.S.C. § 2258A on actual knowledge. **Do not improvise this during an
incident.**

**B2.2 — Strengthen moderation.** [moderate.ts](apps/web/src/lib/moderation/moderate.ts)
runs once per turn at lock time and **fails open to `flag`** when the model call
fails. That is the right call for availability, and wrong for a stranger-facing
launch on the most severe categories. Recommend: fail *closed* for a narrow
prohibited set, fail open for everything else. Consider a cheap deterministic
pre-filter before the model call.

**B2.3 — Admin/moderation tooling.** You currently have no way to review
reports, inspect a story, suspend a user, or remove content except by hand in
the database. `story_reports` exists; nothing surfaces it. At minimum: a report
queue, user suspension, and content removal.

**B2.4 — Crisis resources.** Collaborative fiction surfaces self-harm ideation.
Have a policy and a resource link ready. The Acceptable Use Policy tells users
to call emergency services; make sure your report flow does not imply you
provide emergency response.

**B2.5 — Consent tooling** (recommended, not blocking). A per-story content
agreement acknowledged on join, plus lines/veils and a pause-and-flag control.
Established tabletop practice, and it prevents the most common real harm in
stranger rooms.

**B2.6 — Ban evasion.** Magic-link auth means a banned user re-registers with a
new email in thirty seconds. Decide how much you care.

### Track B3 — Abuse resistance ⛔ BLOCKING

**B3.1 — Rate limiting.** Nothing is rate-limited today. Priorities: sign-in
requests (email bombing), story/universe creation, research pipeline runs
(5–15 min of expensive calls), turn generation, invite and share-link creation.
Upstash Redis or Supabase-backed counters both work.

**B3.2 — Abuse-resistant signup.** Rate limits plus, if needed, a CAPTCHA
(Supabase Auth supports hCaptcha/Turnstile natively).

**B3.3 — Share-link hardening.** Public share links are unauthenticated URLs.
Ensure tokens are high-entropy, revocable, and optionally expiring. The Privacy
Policy states plainly that these are effectively public — keep that true.

**B3.4 — Prompt-injection defense.** User content flows into prompts for the
narrator, validator, extractor, moderator, and gatekeeper. The Acceptable Use
Policy states content is treated as data, not instructions. Verify prompt
construction actually enforces that separation, especially in the **moderator**
(where injection is most damaging) and in **uploaded research source
materials** (attacker-controlled documents entering the research pipeline).

**B3.5 — Security review.** Run `/security-review` on the codebase. Specifically
verify: RLS coverage (`supabase db query --linked --file
supabase/tests/rls_coverage.sql`), `supabase db advisors --linked`, that the
service-role key never reaches a client bundle, and that worker secrets are
strong.

### Track B4 — Operations

**B4.1 — Support channel.** A real inbox someone reads. Terms and Privacy
promise response times — pick ones you can meet.

**B4.2 — Status/incident communication.** Even a pinned notice.

**B4.3 — Runbook.** What to do when generation fails across the board, a
provider goes down, costs spike, or a data-deletion request arrives.

**B4.4 — Analytics** (optional). If added, the Privacy Policy's cookie section
changes and an EU consent banner becomes mandatory. A cookieless option like
Plausible avoids the banner.

### Tier B exit criteria

- [ ] Legal docs finalized, lawyer-reviewed, served in-app, acceptance recorded
- [ ] DMCA agent registered
- [ ] CSAM procedure documented and NCMEC account registered
- [ ] Rate limiting on all expensive and abusable paths
- [ ] Moderation queue and suspension tooling exist
- [ ] Account deletion works and matches the Privacy Policy
- [ ] Security review complete, findings addressed

---

## Part 4: Tier C — Commercial

### Track C1 — Account deletion and data rights ⛔ BLOCKING (also required for Tier B)

**C1.1 — Design the deletion semantics first.** The tension is real: cascade
deletion destroys other members' collaborative work, and `entity_history` is
append-only by architectural rule (CLAUDE.md #3).

Recommended resolution: **anonymize authorship, preserve published chapters.**
Delete the account, email, profile, and API keys; null or tombstone
`user_id` references; retain published chapters as part of the story. Whatever
you choose, the Privacy Policy §9.2 must describe it exactly.

**C1.2 — Implement deletion, self-serve.** Plus data export for portability —
you already have story export, so extend it to a full account export.

**C1.3 — Handle the requests you cannot automate.** Access and correction
requests, with the response windows the Privacy Policy commits to.

### Track C2 — Payments

**C2.1 — Decide the model.** Subscription, credits, or BYOK-plus-fee. AI cost
scales with usage, so flat-rate unlimited is dangerous — a heavy campaign can
exceed any flat price. Credits map most honestly onto the cost structure.

**C2.2 — Integrate a processor.** Stripe. Note that **Merchant of Record**
services (Paddle, Lemon Squeezy) handle international VAT/GST on digital
services for you — worth serious consideration, because digital-services tax
across jurisdictions is genuinely painful and applies from the first sale in
many places.

**C2.3 — Consumer-protection mechanics.** EU/UK consumers have a 14-day
statutory withdrawal right for digital services unless they expressly consent to
immediate performance and acknowledge losing it. Your checkout must capture
that.

**C2.4 — Fill in Terms §10.5–10.6** with real prices, renewal, cancellation,
refund policy, and tax treatment.

**C2.5 — Talk to an accountant** about tax registration thresholds before the
first sale.

### Track C3 — BYOK

**C3.1 — Implement the unused `api_keys` table.** Encryption helpers appear to
exist (`ENCRYPTION_MASTER_KEY` is required at startup); the table has no
readers or writers. Add key entry, validation, per-story vs. per-user scoping,
revocation, and gateway resolution of which key to use.

**C3.2 — Make key-sharing consequences explicit in the UI.** A story owner
sharing a key funds every member's generation. The Terms say so; the UI should
too, at the moment of sharing.

### Track C4 — Reliability

**C4.1 — Decide what you promise.** The current Terms disclaim all uptime
guarantees, which is correct for beta. Paying customers will expect more; only
promise what your architecture delivers.

**C4.2 — Load and cost testing.** Concurrent generation across many stories,
against both provider rate limits and your database connection limits.

**C4.3 — Provider failover.** OpenRouter routes across providers, but model
deprecation is a real recurring event. `usage_log` already tracks
`used_fallback_model` — make sure fallbacks are configured and tested.

---

## Part 5: Cross-Cutting Concerns

**Model deprecation.** Models named in `model_config` will be retired,
sometimes with short notice. Stories pin config. You need a migration story
for stories pinned to a dead model.

**Cost drift.** Provider pricing changes. If you sell at a fixed price, margin
can invert silently. Alert on cost-per-chapter trends, not just totals.

**The marketplace is a rights-exposure surface.** Universes published there are
public and franchise-derived, which converts a private fan-work risk into a
public one. Consider whether marketplace publishing should be restricted at
launch — this is the single easiest way to reduce your IP exposure.

**Docs site.** `docs/` is a Docusaurus build that must stay clean. Decide
whether it ships publicly and whether it needs user-facing (not just
architecture) documentation.

**Accessibility.** Not addressed anywhere so far. Keyboard navigation, contrast,
and screen-reader labels on the turn loop and entity sheets. Cheaper now than
retrofitted, and in some jurisdictions a legal requirement for commercial
services.

**Domain and brand.** The repo is "LarpQuest"; the build plan, docs, and code
all say "StoryForge". **Pick one name before you print it on legal documents and
a domain.** Note that "StoryForge" is a fairly crowded name in games and
software — check trademark availability before committing.

---

## Part 6: Recommended Order

Strictly sequential. Each item is cheap relative to the risk it removes.

**This week — stop the bleeding**
1. Provider-side spend cap (2 minutes) — A2.2
2. `vercel.json` cron + verify the loop runs unattended — A1.1, A1.2
3. Error boundaries and a 404 page — A3.1
4. Sentry + uptime monitor — A3.2, A3.3
5. CI workflow — A3.5

**Next two weeks — Tier A**
6. Spend caps in the gateway — A2.1
7. Production SMTP for magic links — A4.5
8. Verify a backup restore — A3.4
9. Landing page + onboarding pass — A4.1, A4.2
10. **Then run a real campaign with friends for several weeks.**

**Before any stranger sees it — Tier B**
11. Account deletion (also a legal prerequisite) — C1
12. Rate limiting everywhere — B3.1
13. Moderation queue and suspension tooling — B2.3
14. Fill in the legal drafts, then lawyer review — B1.1, B1.2
15. DMCA agent, CSAM procedure, NCMEC account — B1.3, B2.1
16. Security review and prompt-injection audit — B3.4, B3.5
17. Serve legal docs, record acceptance — B1.4

**Only if it is working and people want it — Tier C**
18. BYOK — C3
19. Payments, tax, consumer rights — C2
20. Reliability commitments — C4

---

## Part 7: How to Execute This

Each track above is a candidate openspec change. Follow the existing workflow —
it has served all eight phases well:

```bash
openspec new change "<name>"
openspec validate <change>     # must pass before implementing
openspec archive <change>      # when done
```

Suggested first changes, in order:

1. `scheduled-workers` — cron configuration and unattended-operation verification
2. `spend-caps` — hard-stop budget enforcement in the gateway
3. `operational-resilience` — error boundaries, monitoring, CI
4. `account-deletion` — deletion/anonymization and data export
5. `rate-limiting` — abuse resistance
6. `legal-pages` — serving documents and recording acceptance
7. `moderation-tooling` — report queue, suspension, removal
8. `byok` — per-user and per-story API keys

The engine constraints in `CLAUDE.md` still apply to all of it — particularly
rule 6 (no hardcoded model strings), rule 5 (RLS on every table in its creating
migration), and rule 8 (every model call writes a `usage_log` row). Spend caps
in particular must live in the gateway, not at call sites, for the same reason
model resolution does.

---

## Appendix: Verified Findings

Everything asserted about the current state was checked on 2026-08-20:

| Finding | How verified |
|---|---|
| 437 tests pass, typecheck and build clean | Ran all three |
| No cron configured | No `vercel.json`; no `.github/`; worker routes' own comments state they expect cron |
| No spend cap enforcement | `usage.ts` writes post-hoc only; no pre-call budget check in `src/lib/ai/` |
| `api_keys` unused | Only `database.types.ts` references it |
| No account deletion | No `deleteUser`/`delete_account` anywhere in `src` |
| No rate limiting | No `ratelimit`/`throttle` in `src` |
| No error boundaries | No `error.tsx`/`not-found.tsx`/`loading.tsx` under `src/app` |
| Landing page is a redirect | `src/app/page.tsx` is 9 lines |
| Moderation fails open | `FAIL_OPEN_OUTCOME` in `moderate.ts` returns `flag` on model failure |
| All 8 phases archived | `openspec/changes/archive/` |

---

## Completed

Recorded here as items are finished, so Part 0's audit stays readable as the
snapshot it was rather than being edited into inaccuracy.

### 2026-08-22 — `1ac704f`, `acd24c3`

**A1.1 Scheduler configured.** `apps/web/vercel.json` declares cron entries for
all three worker routes (extraction and memory every minute, deadlines every
five). Vercel Cron issues GET and injects its own non-renameable `CRON_SECRET`,
so the routes now export GET and POST as one handler and accept either secret
through a constant-time check in `lib/worker/auth.ts`. `CRON_SECRET` is
optional; when unset only `WORKER_SECRET` is accepted, so its absence cannot
widen access. Documented at `docs/architecture/scheduling.md`, including the
drain-rate ceiling the single-row workers imply and the Vercel Hobby-plan
constraint on minute-level cron.

*Still open:* A1.2–A1.4 are verification on deployed infrastructure, which
configuration does not substitute for.

**A2.1 Spend caps.** Enforced in the gateway, not at call sites: `GatewayDeps`
and `MediaGatewayDeps` carry a required `BudgetGuard`, consulted by all five
spending entry points. Per-story and per-user caps, nullable, with zero
distinct from absent. Failure of the check refuses the call rather than
allowing it. The overshoot under concurrency is documented rather than papered
over — see `docs/architecture/spend-caps.md`. `/settings/spending` lets a user
set their cap and see spend to date.

*Still open:* A2.2 (provider-side cap — two minutes, and not doable from this
repo), A2.3 (cost alerting), A2.4 (decide who pays).

**A3.1 Error boundaries.** Root `error.tsx`, `global-error.tsx`,
`not-found.tsx`, a story-scoped `error.tsx`, and a story `loading.tsx`. Error
text is never rendered — a thrown error can carry a database message or a
prompt fragment — so the digest is shown instead.

**A3.5 CI.** `.github/workflows/ci.yml` runs test, typecheck, and build for
`apps/web` plus the docs build. The workflow's placeholder environment was
verified by building against exactly it.

Also: `apps/web/.env.example` was being excluded by a blanket `.env*` ignore
rule and had never been committed, so nobody cloning the repo could see what to
configure. Now tracked.
