## ADDED Requirements

### Requirement: Server, client, and edge runtime error capture
The system SHALL initialize Sentry instrumentation for the Node server runtime, the edge runtime,
and the browser client, such that an unhandled exception in any of the three is reported to Sentry
when a DSN is configured.

#### Scenario: DSN configured, server throws
- **WHEN** an unhandled exception occurs in a server component, route handler, or server action
  while `SENTRY_DSN` is set
- **THEN** the exception is captured and sent to Sentry with its stack trace

#### Scenario: DSN configured, edge runtime throws
- **WHEN** an unhandled exception occurs in code running on the edge runtime while `SENTRY_DSN` is
  set
- **THEN** the exception is captured and sent to Sentry

#### Scenario: DSN configured, client throws
- **WHEN** an unhandled exception occurs in the browser while `NEXT_PUBLIC_SENTRY_DSN` is set
- **THEN** the exception is captured and sent to Sentry

### Requirement: No-DSN operation is a no-op, not a failure
The system SHALL run identically whether or not `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set.
Absence of a DSN SHALL disable Sentry transport without throwing, logging errors, or altering any
other behavior.

#### Scenario: Local dev with no DSN
- **WHEN** the app starts with `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` both unset
- **THEN** the app runs normally and no attempt is made to transmit events

#### Scenario: CI build with no DSN
- **WHEN** `npm test`, `npm run typecheck`, and `npm run build` run in an environment with no
  Sentry env vars set
- **THEN** all three complete successfully with no Sentry-related failure

### Requirement: Error boundaries report before rendering their fallback
The system SHALL report the caught error to Sentry from each of the app's error boundaries (root
`error.tsx`, `global-error.tsx`, and the story-scoped `error.tsx`) before rendering its existing
fallback UI. The fallback UI's content (digest-only, never the raw error message) SHALL remain
unchanged by this requirement.

#### Scenario: Root boundary catches an error
- **WHEN** an error is thrown that root `error.tsx` catches
- **THEN** `Sentry.captureException` is called with that error, and the existing digest-only
  fallback still renders as before

#### Scenario: Story-scoped boundary catches an error
- **WHEN** an error is thrown within a story route that `stories/[storyId]/error.tsx` catches
- **THEN** `Sentry.captureException` is called with that error, and the existing digest-only
  fallback still renders as before

#### Scenario: Global boundary catches a root-layout error
- **WHEN** an error is thrown that escapes to `global-error.tsx`
- **THEN** `Sentry.captureException` is called with that error, and the existing digest-only
  fallback still renders as before
