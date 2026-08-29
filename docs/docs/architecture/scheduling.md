---
sidebar_position: 15
---

# Scheduling and unattended operation

Three parts of the turn loop run outside any request: state extraction, chapter
memory, and turn deadlines. Nothing in the app invokes them. Without a
scheduler pointed at their routes the app still appears to work — chapters
publish, players submit — while entity state silently stops updating, memory
retrieval degrades to nothing, and deadlines never fire.

This page describes how those routes are driven in production.

## The three routes

| Route | Work per call | Suggested cadence |
| --- | --- | --- |
| `/api/worker/extract` | Drains the `extraction_queue` | every 15 minutes |
| `/api/worker/memory` | Drains the memory queue | every 15 minutes |
| `/api/worker/deadlines` | Sweeps **every** due turn across all stories | every 15 minutes |

The claim itself is still single-row: `runOneExtraction` and `runOneMemoryJob`
each claim and process exactly one queue row and return `{ claimed: false }`
when the queue is empty. That is the right unit of work — a claim is atomic and
a failure isolates to one row. The route wraps that runner in `drainQueue`
(`lib/worker/drain.ts`), which loops it until the queue empties or a budget is
reached. The deadline sweep has no queue to drain incrementally and handles all
due turns in one pass.

### The drain budget

`drainQueue` stops on the first of four conditions, and reports which in its
`stoppedBecause` field:

- `empty` — the runner reported nothing left to claim. The normal case.
- `max_jobs` — 25 rows processed. A cap, so one invocation cannot run away.
- `time_budget` — 45s elapsed. The routes run in a serverless function with a
  hard execution ceiling; returning a partial drain with a 200 beats being
  killed mid-job and leaving a row `claimed` for stale-claim recovery. Both
  routes declare `maxDuration = 60` to leave the final job room to finish.
- `error` — a job threw. The drain stops rather than swallowing it: the runner
  has already recorded the failure on its own queue row before rethrowing, so
  stopping surrenders only the remaining rows (the next invocation picks them
  up), while continuing risks burning the whole budget looping over the same
  systemic failure — a bad key, a dead provider.

Draining is what makes a low-frequency cron viable. Without it, one invocation
clears one row, so on a daily cron an active story's queue never catches up:
each chapter's state extraction lands a day after publication and every turn is
assembled from stale entity state.

## Configuration

Two schedulers are configured, deliberately:

**`.github/workflows/workers.yml` is the real scheduler.** It POSTs to all
three routes every 15 minutes with `Authorization: Bearer $WORKER_SECRET`.
GitHub Actions imposes no frequency cap, so this works on any Vercel plan. It
needs two repository secrets:

```bash
gh secret set WORKER_BASE_URL --body "https://<your-app>.vercel.app"
gh secret set WORKER_SECRET   --body "<same value as the Vercel env var>"
```

Each route runs in its own step with `if: always()`, so a broken extractor does
not also stop chapter summaries. `workflow_dispatch` is enabled, so a stalled
queue can be drained on demand without waiting for the tick.

**`apps/web/vercel.json` keeps its daily crons as a floor.** They cost nothing
and still drain the queue if the workflow is ever disabled — GitHub turns cron
off on a repo with no activity for 60 days. Vercel Cron issues **GET**
requests, so each worker route exports `GET` and `POST` as the same handler.

## The two secrets

The worker routes accept a bearer token matching **either** `WORKER_SECRET` or
`CRON_SECRET`, compared in constant time.

`WORKER_SECRET` is ours, used by whatever external scheduler we point at the
routes. `CRON_SECRET` exists because Vercel Cron injects that exact variable
name into its own `Authorization` header and offers no way to rename it. Rather
than branching on which scheduler is calling, both names are accepted.

Set both to the same value on Vercel. `CRON_SECRET` is optional in the
environment schema, and when unset only `WORKER_SECRET` is accepted — an absent
`CRON_SECRET` can never widen access.

## Why not Vercel Cron alone

Sub-daily cron is **not available on the Vercel Hobby plan** — and the failure
is worse than it sounds. The dashboard refuses to create a deployment at all
while a sub-daily cron entry exists in `vercel.json`, so the constraint blocks
shipping, not just scheduling. Hence the split above: GitHub Actions drives the
real cadence, and `vercel.json` stays daily so deploys keep working.

The alternatives, if the workflow proves unreliable:

- **Vercel Pro** — raise `vercel.json` to the cadence you want and drop the
  workflow.
- **Another external scheduler** — cron-job.org or Upstash QStash hitting the
  same URLs with the same bearer token.

GitHub Actions' scheduled runs are best-effort and can be delayed several
minutes under load. That is acceptable here: nothing is lost by a late drain,
the queue rows persist, and the daily Vercel crons remain as a floor.

## Verifying it actually runs

Configuration is not verification. On the real deployment, confirm end to end:
submit, lock, generate, publish, then watch extraction run, entity state
update, and the summary and embedding get written before the next turn opens.
Separately confirm that a missed deadline actually locks a turn, and that a
worker killed mid-extraction releases its claim so the row is retried rather
than staying claimed forever — `extraction_queue` has stale-claim recovery on a
five-minute window.
