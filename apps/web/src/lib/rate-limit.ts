import 'server-only';

import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Rate limiting (launch plan B3.1).
 *
 * Backed by `check_rate_limit`, a Postgres function that atomically
 * increments a fixed-window counter and reports whether the caller is still
 * within it. See migration 20260824000006 for why Postgres rather than an
 * external store, and for the fixed-window-vs-sliding-window tradeoff.
 *
 * Every limited action declares its budget here, not at the call site — the
 * same discipline CLAUDE.md rule 6 applies to model resolution and this
 * project already applies to spend caps (`lib/ai/budget.ts`). A limit a call
 * site can misconfigure or skip is not a limit.
 */

export type RateLimitedAction =
  | 'sign_in'
  | 'story_create'
  | 'universe_draft_create'
  | 'turn_generate'
  | 'invite_create'
  | 'share_link_create';

interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

/**
 * Budgets, not tuned against production traffic (none exists yet) — set to be
 * generous for a real user working normally and tight for a script. Revisit
 * once real usage data exists.
 */
const POLICIES: Record<RateLimitedAction, RateLimitPolicy> = {
  // Keyed by IP, not user id — there is no session yet at sign-in. Generous
  // enough that a shared IP (office, campus) doesn't lock out real users, but
  // an email-bombing script hammering the endpoint still gets stopped.
  sign_in: { limit: 5, windowSeconds: 300 },
  story_create: { limit: 10, windowSeconds: 3600 },
  // The research pipeline is 5-15 minutes of expensive model calls per run —
  // the tightest budget here on purpose.
  universe_draft_create: { limit: 5, windowSeconds: 3600 },
  turn_generate: { limit: 30, windowSeconds: 3600 },
  invite_create: { limit: 20, windowSeconds: 3600 },
  share_link_create: { limit: 20, windowSeconds: 3600 },
};

export class RateLimitExceededError extends Error {
  constructor(
    readonly action: RateLimitedAction,
    readonly retryAfterSeconds: number,
  ) {
    super(
      `Too many requests. Try again in ${retryAfterSeconds < 60 ? `${retryAfterSeconds}s` : `${Math.ceil(retryAfterSeconds / 60)}m`}.`,
    );
    this.name = 'RateLimitExceededError';
  }
}

/**
 * Enforce the limit for `action` against `key` (a user id, or an IP address
 * for the pre-session sign-in path). Throws RateLimitExceededError when
 * exceeded; otherwise returns.
 *
 * Fails open on a database error, deliberately: the alternative is a
 * transient DB hiccup taking down sign-in or turn generation entirely, which
 * is a worse outcome than a rate limit briefly not applying. Spend caps make
 * the opposite choice for the opposite reason — see budget.ts — because
 * unbounded spend is the failure being prevented there, and an unenforced
 * rate limit for a few seconds is not a comparable risk.
 */
export async function assertWithinRateLimit(action: RateLimitedAction, key: string): Promise<void> {
  const policy = POLICIES[action];
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .rpc('check_rate_limit', {
      p_action: action,
      p_key: key,
      p_limit: policy.limit,
      p_window_seconds: policy.windowSeconds,
    })
    .single();

  if (error !== null) {
    console.error('Rate limit check failed, failing open', { action, message: error.message });
    return;
  }

  if (!data.allowed) {
    throw new RateLimitExceededError(action, data.retry_after_seconds);
  }
}
