---
sidebar_position: 16
---

# Spend caps

Generation costs real money, and the failure mode that kills products is a
surprise bill. `usage_log` has recorded what every model call cost since Phase
1, but recording is not limiting: nothing consulted a budget before spending,
so a story stuck in a retry loop could spend without bound.

## Where the check lives

In the gateway, not at the call sites — the same discipline that keeps model
resolution there. A check a call site can forget is not a hard stop.

`GatewayDeps` carries a `BudgetGuard` alongside its `UsageRecorder`, and every
entry point that spends money calls it first: `callStructured`, `embedText`,
`streamNarration`, `generateImage`, and `generateVideo`. Making the field
required rather than optional means the type checker enumerates every spending
call site the moment one is added.

The policy itself is in `lib/ai/budget.ts` and is free of I/O, so the decision
is testable without a database. `lib/ai/spend.ts` supplies the numbers.

## Two caps

A **per-story** cap (`stories.spend_cap_usd`) and a **per-user** cap
(`user_preferences.spend_cap_usd`). Both are nullable, and null means "no cap
of my own" — the deployment default applies rather than unlimited spending.
Zero is a real value that stops everything, which is why absent has to be
distinct from zero.

The story cap is checked first: it is the narrower limit and produces the more
actionable message for a room that has run out.

## What it is not

**It is not exact, and it does not claim to be.** Cost is knowable only after a
call returns, so the cap is enforced against spend *already recorded*. Two
consequences follow, both deliberate:

- The call that crosses the cap is allowed to finish. Only the next one is
  refused. Refusing earlier would mean estimating a call's cost beforehand,
  which the provider does not support.
- Concurrent calls can both pass a check that only one should have. The
  overshoot is bounded by (concurrent calls × cost of one call) — cents — and
  reserving estimated budget before each call buys an exactness that costs more
  than it is worth here.

The real backstop is the monthly spend limit set at the provider account. That
one works even when this code has a bug, which is exactly why it should be set
independently.

## Failure is a refusal, not a bypass

A `UsageRecorder` failure is swallowed: losing a generated chapter because its
cost row could not be written would be worse than losing the row. The
`BudgetGuard` is the opposite — if the spend lookup fails, **the call is
refused**. A hard stop that can be defeated by making the check fail is not a
hard stop, and a database that cannot answer "how much has this spent?" is not
one to spend against.

## What the user sees

`SpendCapExceededError` carries a message written to be read by a person, and
turn failure already writes the error message to `turns.failure_reason`. A
capped turn therefore fails with "This story has reached its spend cap
($25.00). Raise the cap in story settings to continue." and stays retryable —
submissions persist independently of generation, so nothing is lost by hitting
a cap.

Users set their own cap and see spend to date at `/settings/spending`.
