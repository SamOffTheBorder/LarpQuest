import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  recordedEmails: [] as string[],
  otpCalls: [] as { email: string }[],
  rateLimitThrows: false,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: 'https://example.test' },
}));

vi.mock('@/lib/request-ip', () => ({
  callerIp: async () => '1.2.3.4',
}));

vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  return {
    ...actual,
    assertWithinRateLimit: async () => {
      if (state.rateLimitThrows) {
        throw new actual.RateLimitExceededError('sign_in', 42);
      }
    },
  };
});

vi.mock('@/lib/legal', () => ({
  recordLegalAcceptance: async (email: string) => {
    state.recordedEmails.push(email);
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      signInWithOtp: async ({ email }: { email: string }) => {
        state.otpCalls.push({ email });
        return { error: null };
      },
    },
  }),
}));

const { signInAction } = await import('@/app/sign-in/actions');

beforeEach(() => {
  state.recordedEmails.length = 0;
  state.otpCalls.length = 0;
  state.rateLimitThrows = false;
});

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe('signInAction', () => {
  it('rejects without the legal agreement checkbox and never sends a link', async () => {
    const result = await signInAction({ status: 'idle' }, formData({ email: 'player@example.com' }));

    expect(result.status).toBe('error');
    expect(result.message).toMatch(/agree/i);
    expect(state.recordedEmails).toHaveLength(0);
    expect(state.otpCalls).toHaveLength(0);
  });

  it('records acceptance and sends the link when the checkbox is checked', async () => {
    const result = await signInAction(
      { status: 'idle' },
      formData({ email: 'player@example.com', agreeToLegal: 'on' }),
    );

    expect(result.status).toBe('sent');
    expect(state.recordedEmails).toEqual(['player@example.com']);
    expect(state.otpCalls).toEqual([{ email: 'player@example.com' }]);
  });

  it('rejects an invalid email before checking the legal agreement', async () => {
    const result = await signInAction({ status: 'idle' }, formData({ email: 'not-an-email' }));

    expect(result.status).toBe('error');
    expect(state.recordedEmails).toHaveLength(0);
  });

  it('does not record acceptance when the rate limit is exceeded', async () => {
    state.rateLimitThrows = true;

    const result = await signInAction(
      { status: 'idle' },
      formData({ email: 'player@example.com', agreeToLegal: 'on' }),
    );

    expect(result.status).toBe('error');
    expect(state.recordedEmails).toHaveLength(0);
    expect(state.otpCalls).toHaveLength(0);
  });
});
