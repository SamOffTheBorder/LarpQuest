---
sidebar_position: 19
---

# Error tracking

Errors thrown in production had nowhere to go. The app's error boundaries
(`error.tsx`, `global-error.tsx`, the story-scoped `error.tsx`) render a
digest-only fallback and log to the console, but a console log on a deployed
server is not something anyone reads. `@sentry/nextjs` closes that gap:
unhandled exceptions on the server, edge, and client runtimes are captured
and correlated with the digest already shown to the user.

## No DSN, no transport

Neither `SENTRY_DSN` nor `NEXT_PUBLIC_SENTRY_DSN` is set by default. Sentry's
own SDK treats an unset DSN as "disabled" rather than an error — `Sentry.init`
still runs, but nothing is transmitted. This is deliberate: no Sentry project
has been provisioned yet, and every environment (local dev, CI, a fresh
clone) must work identically with or without one. `npm test`, `npm run
typecheck`, and `npm run build` all stay clean with these variables absent.

To turn tracking on, create a Sentry project, take its DSN from **Settings ->
Client Keys (DSN)**, and set both variables — `SENTRY_DSN` for server/edge,
`NEXT_PUBLIC_SENTRY_DSN` for the browser bundle. The client variable is
`NEXT_PUBLIC_`-prefixed and shipped to the browser by design, the same as
`NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Where capture happens

- `instrumentation.ts` registers `sentry.server.config.ts` and
  `sentry.edge.config.ts` per Next.js's `register()` convention, and exports
  `onRequestError` so server-rendering errors outside any boundary are still
  captured.
- `instrumentation-client.ts` initializes the browser SDK.
- The three error boundaries each call `Sentry.captureException(error)`
  before rendering their existing fallback. This is additive — the fallback
  UI is unchanged, still digest-only, never the raw error message (an error
  can carry a database message or a prompt fragment, and CLAUDE.md's
  boundary conventions already forbid surfacing that to the user).

Worker routes (`api/worker/extract`, `memory`, `deadlines`) are not
individually instrumented. `sentry.server.config.ts` initializes the whole
Node runtime process, so an unhandled exception in a route handler is
captured the same way as anywhere else on the server — no per-route code
needed.

## What this does not cover

Performance tracing and session replay are both off (`tracesSampleRate: 0`)
— this is exception capture only. Source-map upload at build time needs a
`SENTRY_AUTH_TOKEN`, which is also unset; without it, `withSentryConfig`
skips the upload step with a warning instead of failing the build, so
stack traces will point at minified code until that token is added.
