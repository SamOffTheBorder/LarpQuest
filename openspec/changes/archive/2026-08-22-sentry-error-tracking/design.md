## Context

`apps/web/src/app/error.tsx`, `global-error.tsx`, and `stories/[storyId]/error.tsx` exist from the
`operational-resilience` work (LAUNCH_PLAN A3.1). Each receives `(error, reset)` from Next.js and
renders a fallback that shows only `error.digest`, deliberately never the raw message (an error can
carry a DB message or a prompt fragment). None of them report the error anywhere — the digest is
useless for debugging without a way to look up what it corresponds to, which is exactly what an
error-tracking SDK provides (it correlates the digest/stack with the captured event).

There is no external Sentry project yet. This change makes the code Sentry-ready without requiring
one to exist — with `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` unset, the SDK no-ops (this is standard
`@sentry/nextjs` behavior: init with an empty/undefined DSN disables transport, not throws).

## Goals / Non-Goals

**Goals:**
- Unhandled exceptions on server, client, and edge runtimes are captured when a DSN is configured.
- The three existing error boundaries explicitly report the caught error before rendering their
  existing digest-only fallback.
- Local dev, tests, and CI continue to work with no DSN set — Sentry must never become a hard
  dependency for `npm test` / `npm run typecheck` / `npm run build`.
- The instrumentation is a thin, standard SDK wire-up — no custom abstraction layer.

**Non-Goals:**
- No performance tracing, session replay, or release/source-map upload pipeline in this change.
- No in-app UI for viewing errors (that's Sentry's own dashboard).
- No changes to worker route handlers — `sentry.server.config.ts` instruments the whole server
  runtime, including route handlers, automatically once initialized.
- No model calls, no persisted state, no RLS surface — CLAUDE.md rules 5–8 don't apply to this
  change.

## Decisions

**Use `@sentry/nextjs`'s own setup shape rather than hand-rolling instrumentation.**
The package publishes a documented, version-pinned convention for Next.js App Router
(`instrumentation.ts` registering `sentry.server.config.ts` / `sentry.edge.config.ts`, plus
`instrumentation-client.ts` for the browser bundle, depending on SDK version). Deviating from that
convention risks missing a runtime (edge middleware/`proxy.ts` in particular runs on the edge
runtime, not Node). Alternative considered: manual `try/catch` + `fetch` to Sentry's ingest API —
rejected, reinvents what the SDK does correctly, including breadcrumbs and source-map handling
later.

**DSN is optional configuration, read via `process.env`, not `stories.model_config` or any
per-story setting.** Error tracking is an operator-level (site-wide) concern, unlike the per-story
`model_config` pattern used for AI role resolution (CLAUDE.md rule 6) — these are unrelated
concerns and this one has no per-story dimension. Alternative considered: making it configurable
per-deployment via a DB row — rejected as needless complexity; env var is standard practice for
this kind of operational secret and matches how `OPENROUTER_API_KEY` etc. are already handled.

**Capture in the error boundaries via `Sentry.captureException(error)` called in a `useEffect`
(client components) at the top of each boundary, before the existing fallback JSX.** Next.js error
boundaries are client components by requirement; `useEffect` is the standard place to run a
side-effect on catch, matching Sentry's own documented Next.js App Router example. Alternative
considered: capturing only in `sentry.server.config.ts`'s automatic instrumentation and skipping
the boundary-level call — rejected because client-side render errors (e.g., a bad prop from a
server component) surface only to the client error boundary, never reaching server instrumentation.

**No changes to worker routes.** `sentry.server.config.ts` instruments the Node runtime process,
so unhandled exceptions in `api/worker/*` route handlers are captured the same way any other server
error is, without per-route code. Explicit `Sentry.captureException` calls already exist implicitly
nowhere in those routes today (they return typed error responses on failure paths, which is
correct existing behavior and out of scope to change here).

## Risks / Trade-offs

**[Risk] Sentry client bundle increases JS payload size.** → Mitigation: `@sentry/nextjs` tree-shakes
via its Next.js plugin; accept the standard bundle cost as the trade-off for observability. Not
worth optimizing further in a friends-tier launch.

**[Risk] A DSN accidentally committed to source.** → Mitigation: DSNs go in `.env.local` /
deployment env vars only, never in `.env.example` (which gets a placeholder), consistent with how
every other secret in this repo is handled.

**[Risk] Sentry's build-time step (`withSentryConfig`, source-map upload) could break `npm run
build` if misconfigured.** → Mitigation: source-map upload requires a `SENTRY_AUTH_TOKEN` too;
without it, the wizard's default config skips the upload step with a warning rather than failing
the build. Verify `npm run build` stays clean with and without env vars set, per CLAUDE.md
verification requirements.

## Migration Plan

1. Install `@sentry/nextjs`, run its setup (or hand-write the equivalent config files matching its
   documented convention for the installed major version).
2. Wire the three error boundaries.
3. Add env vars to `.env.example` (empty/placeholder values) and to `docs/architecture/error-tracking.md`.
4. Verify `npm test`, `npm run typecheck`, `npm run build` all stay clean with no DSN set (the
   state every environment will be in until the user provisions a Sentry project).
5. Rollback: revert the commit — no persisted state, no migration, nothing to unwind server-side.

## Open Questions

- Which Sentry plan/org the user will actually use, and when they'll provision the DSN, is outside
  this change's scope — tracked as "still open" in LAUNCH_PLAN.md until the user does that
  external step.
