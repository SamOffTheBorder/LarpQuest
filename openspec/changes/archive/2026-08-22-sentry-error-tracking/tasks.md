## 1. Install and configure the SDK

- [x] 1.1 Add `@sentry/nextjs` to `apps/web/package.json` and install.
- [x] 1.2 Create `apps/web/sentry.server.config.ts`, `apps/web/sentry.edge.config.ts`, and the
      client entry point (`instrumentation-client.ts` or `sentry.client.config.ts`, per the
      installed SDK version's documented convention), each reading its DSN from the appropriate
      env var and initializing with transport disabled when unset.
- [x] 1.3 Create/verify `apps/web/instrumentation.ts` registers the server and edge configs per
      the SDK's Next.js App Router convention.
- [x] 1.4 Wrap `apps/web/next.config.ts` (or existing `.mjs`/`.js`) with `withSentryConfig`,
      configured so a missing `SENTRY_AUTH_TOKEN` skips source-map upload with a warning rather
      than failing the build.

## 2. Wire the existing error boundaries

- [x] 2.1 Update `apps/web/src/app/error.tsx` to call `Sentry.captureException(error)` in a
      `useEffect` before the existing digest-only fallback renders.
- [x] 2.2 Update `apps/web/src/app/global-error.tsx` the same way.
- [x] 2.3 Update `apps/web/src/app/stories/[storyId]/error.tsx` the same way.
- [x] 2.4 Confirm none of the three boundaries' rendered output changes (still digest-only, never
      the raw error message).

## 3. Configuration and documentation

- [x] 3.1 Add `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` to `apps/web/.env.example` as empty/
      placeholder values with a comment marking them optional.
- [x] 3.2 Write `docs/docs/architecture/error-tracking.md`: what is captured, what isn't, how the
      no-DSN no-op behavior works, and how to provision a DSN when ready. (Actual path is
      `docs/docs/architecture/`, not `docs/architecture/` as originally written.)
- [x] 3.3 Link the new doc page in `docs/sidebars.ts`, matching existing doc navigation.

## 4. Verification

- [x] 4.1 Run `npm test`, `npm run typecheck`, `npm run build` in `apps/web` with no Sentry env
      vars set — all three must stay clean. (485 tests passed, typecheck clean, build clean with
      no deprecation warnings after removing the two deprecated `withSentryConfig` options.)
- [x] 4.2 Run `npm run build` in `docs` — must stay clean (no link rot from the new doc page).
      (Docusaurus build succeeded.)
- [x] 4.3 Verified by code inspection instead of a live trigger: no Sentry project/DSN exists yet
      to point a scratch throw at (this change's own non-goal — see design.md). Each of the three
      boundaries now calls `Sentry.captureException(error)` unconditionally in its `useEffect`
      before the unchanged fallback renders; with no DSN this is a documented no-op per the SDK's
      own behavior, exercised indirectly by every existing test that already renders these
      boundaries.
