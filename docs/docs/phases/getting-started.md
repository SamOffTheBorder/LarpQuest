---
sidebar_position: 3
title: Getting Started — Running StoryForge
---

# Getting Started — Running StoryForge

Phase 1's infrastructure is live: a hosted Supabase project, migrations applied, RLS and advisor audits passing, real OpenRouter credentials, and a working end-to-end flow from sign-in through story creation, submissions, generation, and extraction. This page is the setup checklist for running it yourself, plus what's still genuinely open.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com), or run the stack locally with the [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker via `supabase start` (config already written in `supabase/config.toml`).
2. **Copy `apps/web/.env.example` to `apps/web/.env.local`** and fill in every value:
   - `NEXT_PUBLIC_SITE_URL` — absolute origin for magic-link redirects, e.g. `http://localhost:3000`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from Supabase Settings → API
   - `OPENROUTER_API_KEY` — from [openrouter.ai/keys](https://openrouter.ai/keys); a few dollars of credit covers a lot of Phase 1 testing
   - `ENCRYPTION_MASTER_KEY` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. The app refuses to start without exactly 32 bytes, base64-encoded, trailing `=` included.
   - `WORKER_SECRET` — bearer token the extraction worker route requires. Generate with `node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"`.
3. **In your Supabase project's dashboard**, under Authentication → URL Configuration, add your callback URL (e.g. `http://localhost:3000/auth/callback`) to the redirect allowlist. Magic links fail silently without this.
4. **Push migrations and audit**: `supabase link --project-ref <ref>`, then `supabase db push`. Follow with `supabase db advisors --linked` and `supabase db query --linked --file supabase/tests/rls_coverage.sql` — both should report clean.
5. **Generate DB types**: `npm run db:types` from `apps/web`.
6. **Run it**: `npm run dev` from `apps/web`. Watch for port 3000 collisions with the Docusaurus dev server (`docs`) — pass `-- -p 3100` if so.

## The golden path

Sign in with a magic link → land on `/stories` → create a story → open a turn → add entities (`/stories/<id>/entities`) → submit an action → lock and generate → read the published chapter. Extraction runs separately; trigger it manually while no scheduler is wired up:

```bash
curl -X POST http://localhost:3000/api/worker/extract \
  -H "Authorization: Bearer <your WORKER_SECRET>"
```

One call claims and processes one queued job.

## What's still open

- **No scheduler calls the extraction worker.** The route and worker logic are built and tested, but nothing triggers `/api/worker/extract` automatically — chapters will sit at `extraction_status: pending` until you either call it manually or wire up a cron (Vercel Cron, a Supabase scheduled function, GitHub Actions, etc.). This is a hosting decision, not something to default silently.
- **Phase Exit Verification is mostly tooled but not run.** Two structurally different test universes exist as fixtures (`src/lib/engine/test-universes.ts`) but aren't seeded into the database yet — that needs a real signed-in user to own them. A no-state baseline comparison tool exists (`/stories/<id>/baseline/<turnNumber>`, linked from each chapter) but hasn't been run against a real ten-chapter story. Rollback works and is tested against live tables, but not yet exercised mid-story. What's left is genuinely a "play the game for ten turns, twice" exercise, not more building — see `openspec/changes/phase-1-generic-core/tasks.md` section 10 for the exact checklist.

## Product decisions worth your input

Not blocked on infrastructure — genuinely yours to call:

- **World ledger maintenance.** Hand-maintained by the user, or extractor-maintained? The design doc leans hand-maintained for Phase 1 to avoid unvalidated drift, but it's not settled.
- **Partial-generation salvage UX.** When a stream times out, can a user publish the salvaged partial prose directly, or must they always regenerate?
- **Token counting precision.** The current estimate (`length / 4`) is a fast approximation with a safety margin. Fine for now; worth revisiting only if budget errors show up in practice.
