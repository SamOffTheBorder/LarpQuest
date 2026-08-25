## Why

Errors from friends and, later, strangers currently disappear. `apps/web/src/app/error.tsx` and
`global-error.tsx` (added in the `operational-resilience` work) render a fallback UI but report
nothing anywhere — the only record of a production failure is whatever the user happens to
describe after the fact. LAUNCH_PLAN.md item A3.2 names this as a Tier A blocker: "You cannot fix
what your friends do not report, and they will not report most of it." This is polish/operations
work, not engine work, and belongs after the phase-8 engine build (already archived) is complete —
it does not touch turn loop, universe, or research code.

## What Changes

- Add `@sentry/nextjs` and run its Next.js 15/16 setup: `sentry.client.config.ts`,
  `sentry.server.config.ts`, `sentry.edge.config.ts` (or the newer `instrumentation.ts` /
  `instrumentation-client.ts` entry points, whichever the installed SDK version targets), plus
  `next.config` wrapping via `withSentryConfig`.
- Report captured errors from the existing boundaries: root `error.tsx`, `global-error.tsx`, and
  the story-scoped `error.tsx` all currently swallow the error into a UI message only — wire each
  to call `Sentry.captureException` before rendering the digest-only fallback (CLAUDE.md/A3.1
  already forbid rendering raw error text, which stays true — Sentry receives the full error,
  the user still sees only the digest).
  - Do **not** wrap the worker routes (`api/worker/extract`, `api/worker/memory`,
    `api/worker/deadlines`) in this change — server-side capture via `sentry.server.config.ts`
    already covers unhandled route exceptions automatically once the SDK is initialized; no
    per-route code changes needed there.
- Add `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (client) to `apps/web/.env.example`,
  documented as optional — the app must run identically with them unset (local dev, CI) since no
  DSN has been provisioned yet.
- Document the integration at `docs/architecture/error-tracking.md` (new page), covering what is
  and isn't captured, and how to obtain/set a DSN when ready to use it.
- No conditional on genre/universe/media type is possible here — this change touches no engine
  code path.

## Capabilities

### New Capabilities
- `error-tracking`: server, client, and edge error capture via Sentry, wired to the existing error
  boundaries, with the DSN treated as optional configuration.

### Modified Capabilities
(none — no existing spec's requirements change; this adds observability alongside the
already-specified error-boundary behavior from `operational-resilience`, which is implementation
history rather than a tracked capability spec)

## Impact

- New dependency: `@sentry/nextjs`.
- New files: `apps/web/sentry.client.config.ts`, `sentry.server.config.ts`,
  `sentry.edge.config.ts` (exact filenames per SDK version's own setup wizard/docs),
  `docs/architecture/error-tracking.md`.
- Modified files: `apps/web/next.config.ts` (or `.mjs`/`.js`, whichever exists),
  `apps/web/src/app/error.tsx`, `apps/web/src/app/global-error.tsx`,
  `apps/web/src/app/stories/[storyId]/error.tsx`, `apps/web/.env.example`.
- No database migration, no RLS surface, no model call — outside the scope of CLAUDE.md rules
  6–8.
- Build plan phase: Polish (Phase 8, already archived) / post-engine operational hardening per
  LAUNCH_PLAN.md Part 2 Track A3. Does not reorder or reopen any build-plan phase.

## Non-goals

- Not implementing performance monitoring, session replay, or release tracking — capture of
  unhandled exceptions and the existing error boundaries only.
- Not provisioning an actual Sentry account/project/DSN — that is an external step for the user
  (LAUNCH_PLAN.md explicitly notes several Tier A items "cannot be done from this repo alone").
  This change makes the code ready to receive a DSN, not the DSN itself.
- Not adding Sentry to the `docs/` Docusaurus site — LAUNCH_PLAN.md's scope for A3.2 is the
  application, not the documentation site.
- Not touching worker route logic beyond what automatic server-side instrumentation provides.
