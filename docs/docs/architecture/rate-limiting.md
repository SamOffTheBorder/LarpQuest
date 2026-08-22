---
sidebar_position: 18
---

# Rate limiting

Nothing limited how often a caller could hit an expensive or abusable path:
sign-in (email bombing), story or universe creation, turn generation, invite
creation. The research pipeline in particular is 5-15 minutes of expensive
model calls per run.

## Backed by Postgres, not an external store

The launch plan suggested Upstash Redis or Supabase-backed counters. This
deployment already depends on Postgres for every other piece of shared
coordination — `extraction_queue`, `spend_to_date` — and a second store is a
cost this scale does not justify. `check_rate_limit` (migration
`20260824000006`) is the same tradeoff `spend_to_date` already makes for
money: a fixed-window counter, checked and incremented in one atomic
statement, not exact under extreme concurrency, correct for the case that
actually matters — one caller looping, not a distributed attack timed to the
millisecond.

Fixed windows, not sliding: the window is floored to a boundary rather than
tracked as a rolling range, so a caller can in principle burst up to 2x the
limit across a window edge. That is the trade for one indexed upsert instead
of a scan over a sliding range on every check.

## Enforcement lives in one place per action

`lib/rate-limit.ts`'s `POLICIES` table declares every limited action's budget
— the same discipline CLAUDE.md rule 6 applies to model resolution, and this
project already applies to spend caps. A limit a call site can misconfigure or
skip is not a limit.

| Action | Limit | Key |
| --- | --- | --- |
| `sign_in` | 5 / 5 min | caller IP (no session exists yet) |
| `story_create` | 10 / hour | user id |
| `universe_draft_create` | 5 / hour | user id |
| `turn_generate` | 30 / hour | user id |
| `invite_create` | 20 / hour | user id |

Not tuned against production traffic — none exists yet. Set to be generous for
someone working normally and tight for a script; revisit once real usage data
exists.

## Fails open

A `UsageRecorder` failure is swallowed and a `BudgetGuard` failure refuses the
call — deliberately opposite choices, explained in `spend-caps.md`. Rate
limiting makes the `UsageRecorder` choice: if the database check itself
errors, `assertWithinRateLimit` logs and returns rather than throwing. A
transient DB hiccup taking down sign-in entirely is a worse outcome than a
rate limit briefly not applying, and unlike unbounded spend, a few
unenforced seconds of a rate limit is not a comparable risk.

## Sign-in has no session to key on

Every other limited action runs after `requireUser()`, so it is keyed by
`user.id`. Sign-in is how a session comes to exist, so it is keyed by IP
instead — `lib/request-ip.ts` reads `x-forwarded-for`, set by Vercel's edge
network and most reverse proxies. A request that reaches the app directly
(local dev, a misconfigured proxy) has no such header and falls back to a
shared bucket, weakening the limit for every such request. Harmless in local
dev; worth revisiting if this deployment is ever exposed without a proxy that
sets the header.
