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
| `/api/worker/extract` | Claims and processes **one** `extraction_queue` row | every minute |
| `/api/worker/memory` | Claims and processes **one** memory job | every minute |
| `/api/worker/deadlines` | Sweeps **every** due turn across all stories | every 5 minutes |

Extraction and memory are single-row workers by design: one call claims one
row, so a scheduler polling the endpoint drains the queue over successive calls
rather than one request running an unbounded loop against a serverless
timeout. The deadline sweep has no queue to drain incrementally and handles all
due turns in one pass.

### Drain rate is a real ceiling

One row per invocation at one invocation per minute is **one chapter extracted
per minute, across the whole deployment**. A single story publishing a chapter
every few minutes is comfortably served. A backlog — many stories publishing at
once, or a burst after an outage — drains at that fixed rate and no faster.

This is the correct trade for a small deployment and the wrong one at scale.
When it starts to bite, the fix is more frequent invocation or a worker that
claims a batch per call, not a longer-running loop inside one request.

## Configuration

`apps/web/vercel.json` declares the cron entries. Vercel Cron issues **GET**
requests, so each worker route exports `GET` and `POST` as the same handler;
external schedulers that POST work unchanged.

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

## Choosing a scheduler

Minute-level cron is **not available on the Vercel Hobby plan**, which limits
deployments to a small number of jobs at daily granularity. This is a real
constraint on the cadences above, not a detail:

- **Vercel Pro** — `vercel.json` works as written.
- **An external scheduler** — GitHub Actions on a schedule, cron-job.org, or
  Upstash QStash hitting the same URLs with `Authorization: Bearer
  $WORKER_SECRET`. Note that GitHub Actions' scheduled runs are best-effort and
  can be delayed by several minutes under load.

## Verifying it actually runs

Configuration is not verification. On the real deployment, confirm end to end:
submit, lock, generate, publish, then watch extraction run, entity state
update, and the summary and embedding get written before the next turn opens.
Separately confirm that a missed deadline actually locks a turn, and that a
worker killed mid-extraction releases its claim so the row is retried rather
than staying claimed forever — `extraction_queue` has stale-claim recovery on a
five-minute window.
