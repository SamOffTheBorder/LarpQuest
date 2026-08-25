import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The TS layer's only real logic: translate the RPC's {allowed, retry_after}
 * into either a return or a RateLimitExceededError, and fail open (rather
 * than blocking the caller) when the check itself cannot be answered.
 */

const state = vi.hoisted(() => ({
  response: { data: null as { allowed: boolean; current_count: number; retry_after_seconds: number } | null, error: null as { message: string } | null },
  lastArgs: null as Record<string, unknown> | null,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    rpc(fn: string, args: Record<string, unknown>) {
      state.lastArgs = args;
      return {
        single: async () => state.response,
      };
    },
  }),
}));

beforeEach(() => {
  state.response = { data: null, error: null };
  state.lastArgs = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('assertWithinRateLimit', () => {
  it('returns without throwing when allowed', async () => {
    state.response = { data: { allowed: true, current_count: 1, retry_after_seconds: 0 }, error: null };

    const { assertWithinRateLimit } = await import('./rate-limit');
    await expect(assertWithinRateLimit('sign_in', '1.2.3.4')).resolves.toBeUndefined();
  });

  it('passes the action-specific policy to the RPC', async () => {
    state.response = { data: { allowed: true, current_count: 1, retry_after_seconds: 0 }, error: null };

    const { assertWithinRateLimit } = await import('./rate-limit');
    await assertWithinRateLimit('turn_generate', 'user-1');

    expect(state.lastArgs).toMatchObject({ p_action: 'turn_generate', p_key: 'user-1' });
    expect(state.lastArgs?.p_limit).toBeGreaterThan(0);
    expect(state.lastArgs?.p_window_seconds).toBeGreaterThan(0);
  });

  it('throws RateLimitExceededError with the retry time when denied', async () => {
    state.response = { data: { allowed: false, current_count: 6, retry_after_seconds: 42 }, error: null };

    const { assertWithinRateLimit, RateLimitExceededError } = await import('./rate-limit');

    const error = await assertWithinRateLimit('sign_in', '1.2.3.4').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitExceededError);
    expect((error as InstanceType<typeof RateLimitExceededError>).retryAfterSeconds).toBe(42);
  });

  it('has a policy for share_link_create', async () => {
    state.response = { data: { allowed: true, current_count: 1, retry_after_seconds: 0 }, error: null };

    const { assertWithinRateLimit } = await import('./rate-limit');
    await assertWithinRateLimit('share_link_create', 'user-1');

    expect(state.lastArgs).toMatchObject({ p_action: 'share_link_create', p_key: 'user-1' });
    expect(state.lastArgs?.p_limit).toBeGreaterThan(0);
    expect(state.lastArgs?.p_window_seconds).toBeGreaterThan(0);
  });

  it('fails open — does not throw — when the database check itself errors', async () => {
    state.response = { data: null, error: { message: 'connection refused' } };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { assertWithinRateLimit } = await import('./rate-limit');
    await expect(assertWithinRateLimit('sign_in', '1.2.3.4')).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });
});
