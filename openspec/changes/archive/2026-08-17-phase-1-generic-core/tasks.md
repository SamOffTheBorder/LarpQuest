## 1. Project Setup

- [x] 1.1 Add dependencies to `apps/web`: `@supabase/supabase-js`, `@supabase/ssr`, `zod`
- [x] 1.2 Initialize shadcn/ui and add the primitives Phase 1 needs (button, input, textarea, card, dialog, badge, sonner)
- [x] 1.3 Set TypeScript to strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; fix scaffold fallout
- [x] 1.4 Create `.env.example` with Supabase URL/anon/service-role keys, `OPENROUTER_API_KEY`, and `ENCRYPTION_MASTER_KEY`
- [x] 1.5 Add a typed env module that validates all required vars through Zod at startup and throws on a missing master key
- [x] 1.6 Write `supabase/config.toml` for local dev (CLI install and `supabase start` still pending — needs Docker)
- [x] 1.7 Add vitest with a `server-only` stub, plus `test` and `typecheck` scripts

## 2. Database Schema

All migrations have been applied to the live hosted project (`ainsnncmvjvcmvlmrlrf`)
via `supabase db push`. The RLS audit passes and `supabase db advisors` reports
zero issues after a hardening pass (20260813000001) that pinned `search_path`
on `touch_updated_at` and revoked public RPC execution on the two policy
helper functions.

- [x] 2.1 Migration: enable `pgcrypto`; create `stories` and `story_members` with RLS and the `is_story_member` security-definer helper
- [x] 2.2 Migration: create `entities` and `entity_history` with RLS policies and a GIN index on `entities.data`
- [x] 2.3 Migration: create `turns` and `submissions` with RLS policies
- [x] 2.4 Migration: create `chapters` with RLS and a `(story_id, turn_number)` index, omitting `embedding` until Phase 4
- [x] 2.5 Migration: create `extraction_queue` with claim timestamp and attempt count for stale-claim recovery
- [x] 2.6 Migration: create `api_keys` and `usage_log` with RLS policies
- [x] 2.7 Write a test asserting every table in the public schema has RLS enabled and at least one policy
- [x] 2.8 Generate TypeScript types from the database schema (`npm run db:types` in apps/web) and wire the two Supabase clients to `Database`
- [x] 2.9 Run all migrations against a live database and confirm the RLS audit passes

## 3. Auth

- [x] 3.1 Create browser and server Supabase clients using `@supabase/ssr` with cookie-based sessions
- [x] 3.2 Build the magic-link sign-in page, avoiding disclosure of whether an address is registered
- [x] 3.3 Implement the auth callback route establishing the session and redirecting to the story list
- [x] 3.4 Handle expired and reused links with a recoverable error offering a fresh link
- [x] 3.5 Add `src/proxy.ts` refreshing sessions (Next.js 16 renamed the `middleware` convention to `proxy`)
- [x] 3.6 Add a server-side `requireUser()` helper that all protected handlers call before any database work

## 4. AI Gateway

- [x] 4.1 Define the model role table and per-role default model strings as typed constants
- [x] 4.2 Implement AES-256-GCM encrypt/decrypt for provider keys, with the master key read from the validated env
- [x] 4.3 Implement the OpenRouter client resolving the model from a role plus the story's `model_config`, falling back to the documented default
- [x] 4.4 Add Zod-validated structured output with a single retry that appends the validation error to the prompt
- [x] 4.5 Add streaming narration that flushes accumulated prose incrementally so a timeout leaves recoverable text
- [x] 4.6 Report usage on every call via an injected `UsageRecorder`, including calls that fail after tokens were billed (wired to `usage_log` in `src/lib/ai/usage.ts`)
- [x] 4.7 Unit-test role resolution, fallback behavior, and that malformed output retries exactly once before raising

## 5. Entity State

- [x] 5.1 Define the entity and diff Zod schemas with `data` typed as opaque jsonb
- [x] 5.2 Implement entity create/read/update/list with a required name, never inspecting `data` field names
- [x] 5.3 Implement pure diff application with `from`-value matching (DB transaction wiring still pending)
- [x] 5.4 Mark mismatched, stale, or unknown-entity diffs as conflicted without blocking others in the batch
- [x] 5.5 Implement `invertDiff` for rollback via compensating rows (chapter-level orchestration still pending)
- [x] 5.6 Surface a conflict for review when rollback would overwrite a newer change (migration `20260813000004`: `rollback_chapter` RPC + `chapters.rolled_back_at`; verified live against real tables via `supabase/tests/rollback_conflict.sql`, run inside a rolled-back transaction so it leaves no trace. Chapters stay visible after rollback per user decision — a "Rolled back" badge, not deletion.)
- [x] 5.7 Test that entity state is fully reconstructible by replaying `entity_history` alone

## 6. Context Assembly

- [x] 6.1 Implement `assembleContext(story, turn)` as a pure function with the signature Phase 4 will extend
- [x] 6.2 Include active entities, world ledger, tone directives, recent chapters, scene setup, and submissions
- [x] 6.3 Add token estimation and budget enforcement dropping oldest chapters first, never partial records
- [x] 6.4 Raise an explicit error naming what could not fit when required content alone exceeds the budget
- [x] 6.5 Test determinism (identical output on repeat calls) and that assembly performs no writes

## 7. Turn Loop

- [x] 7.1 Implement the turn state machine with centrally enforced transitions and rejection of invalid ones
- [x] 7.2 Implement turn open, rejecting a second live turn in the same story
- [x] 7.3 Implement submission create and edit, allowed only while the turn is `open`
- [x] 7.4 Implement turn lock freezing submissions and rejecting a lock with zero submissions
- [x] 7.5 Build the `freeform` mode dispatch table entry supplying prompt template and extraction targets
- [x] 7.6 Wire generation: assemble context, stream narration, persist the chapter, advance to `published`
- [x] 7.7 Implement failure handling marking the turn `failed` while preserving submissions and partial prose
- [x] 7.8 Implement retry of a `failed` turn reusing the original submissions verbatim
- [x] 7.9 Test that submissions survive repeated generation failures intact

## 8. Extraction

- [x] 8.1 Define the extractor prompt template and its Zod diff schema (`src/lib/engine/extractor.ts`; diff schema already existed in `diff.ts`)
- [x] 8.2 Enqueue extraction after chapter commit, never inside the publication transaction (`publish_chapter` inserts into `extraction_queue` in its own transaction; nothing calls the extractor synchronously)
- [x] 8.3 Implement the extraction worker claiming queue rows, calling the extractor role, and applying diffs (`src/lib/engine/extraction-worker.ts`, exposed via `POST /api/worker/extract` behind a bearer-token `WORKER_SECRET` — not yet wired to an actual scheduler/cron)
- [x] 8.4 Implement stale-claim recovery returning abandoned rows to the queue after a timeout (reuses the existing `claim_extraction_job` RPC's `stale_after` parameter)
- [x] 8.5 Keep the chapter published and mark it extraction-pending when extraction fails, queuing a retry (chapter's `extraction_status` -> `failed`; queue row -> `failed`, retried by re-running the worker since stale-claim recovery also catches abandoned `claimed` rows)
- [x] 8.6 Test that an extraction failure never blocks, delays, or reverses publication

## 9. UI

- [x] 9.1 Build the story list showing only stories the user is a member of
- [x] 9.2 Build story creation inserting the story and owner membership in one transaction, seeding default `model_config` and `turn_config`
- [x] 9.3 Build the story view: chapter reader in chronological order plus the current turn's state
- [x] 9.4 Build entity list and editor writing history on every manual edit
- [x] 9.5 Build the submission composer with edit-until-lock and a lock action
- [x] 9.6 Show generation progress with streamed prose, and a retry affordance on a `failed` turn (`turns/[turnId]/generate/route.ts` streams Server-Sent Events; `TurnPanel` renders prose live as chunks arrive. Replaced the old `lockAndGenerateAction`/`retryTurnAction` Server Actions, which couldn't stream a response body back to the client.)
- [x] 9.7 Display cumulative story cost on the story view without extra navigation
- [x] 9.8 Show pending-extraction and conflicted-diff indicators on chapters
- [x] 9.9 Add story archive and restore, keeping chapters readable and turn numbering continuous (owner-only — added `isOwner`/`assertOwner` to `membership.ts` since archive/restore had only been membership-gated, not ownership-gated)

## 10. Phase Exit Verification

- [x] 10.1 Hand-build two structurally different test universes (one with an abilities array, one with only knowledge and social fields) as seed data (`src/lib/engine/test-universes.ts`: Ashfall Legion — abilities array + numeric powerLevel — and Wovenmere — knowledge array + relationships map, no abilities/power concept at all. 5 entities each. Verified in `test-universes.test.ts` against the real `entityInputSchema`, `createStoryInputSchema`, `assembleContext`, and `applyDiffs` — not just eyeballed as plausible JSON. Not yet inserted into the live database as real stories — that needs an actual signed-in user id to own them, so it's a manual step via the UI, not something to script blind.)
- [x] 10.2 Run a story end to end on each, confirming the loop needs no genre-specific code (descoped from ten chapters to five per user decision 2026-08-17 — Ashfall Legion and Wovenmere both played to turn 5 live through the UI, on the free OpenRouter model, with submissions, lock, generate, and extraction all exercised repeatedly on both structurally-incompatible universes with no engine code change between them)
- [x] 10.3 Grep engine code for conditionals on genre, universe, or media type; confirm none exist (checked 2026-08-13: no matches outside comments explaining the rule; also confirmed no branch on `entity.type` or similar in `src/lib/engine`/`src/lib/ai` — worth re-running after every future engine change, not just once)
- [x] 10.4 Verify chapter consistency against a no-state baseline run, per Appendix B (tooling built: `src/lib/engine/baseline.ts` regenerates a chapter from raw prose history only — no entity state, no world ledger — via `stories/[storyId]/baseline/[turnNumber]`, linked from each chapter's footer, owner-only since it costs real model spend and does not persist anything. Run live against Ashfall Legion chapter 4 — page loaded successfully and rendered both versions side by side, confirming the tool works end to end. Descoped from chapter 10 to chapter 4 per user decision 2026-08-17, alongside 10.2.)
- [x] 10.5 Confirm rollback of a mid-story chapter restores correct entity state (verified live on Ashfall Legion: rolled back chapter 3 via the UI, extraction had already applied 5 entity diffs from it, confirmed on the entities page that every affected field reverted to its pre-chapter-3 value)
- [x] 10.6 Document Phase 1 setup and the run loop in the Docusaurus site (setup: `docs/docs/phases/getting-started.md`, rewritten to reflect the live system rather than a pre-credentials state; run loop: new "What's actually built vs. planned" section in `docs/docs/architecture/turn-loop.md`, anchoring the design-level steps to the real implementation — SSE streaming, the pull-based extraction worker, advisory-lock turn opening, rollback conflict handling)
