import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The save/remove server actions: auth is required, a blank submission is
 * rejected before any write, and a valid save/remove is delegated to the
 * api-key helpers.
 */

process.env.ENCRYPTION_MASTER_KEY = randomBytes(32).toString('base64');
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.OPENROUTER_API_KEY ??= 'platform-key';
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.WORKER_SECRET ??= 'test-worker-secret-value';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const state = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  saved: [] as { userId: string; plaintext: string }[],
  removed: [] as string[],
}));

vi.mock('@/lib/auth', () => ({
  requireUser: async () => {
    if (state.user === null) {
      throw new Error('redirect: /sign-in');
    }
    return state.user;
  },
}));

vi.mock('@/lib/ai/api-key', () => ({
  saveUserApiKey: async (userId: string, plaintext: string) => {
    if (plaintext.trim().length < 16) {
      throw new Error('That does not look like an API key.');
    }
    state.saved.push({ userId, plaintext });
  },
  deleteUserApiKey: async (userId: string) => {
    state.removed.push(userId);
  },
}));

const { saveOpenRouterKeyAction, removeOpenRouterKeyAction } = await import(
  '@/app/settings/openrouter/openrouter-key-actions'
);

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  state.user = { id: 'user-1' };
  state.saved = [];
  state.removed = [];
});

describe('saveOpenRouterKeyAction', () => {
  it('saves a valid key', async () => {
    const result = await saveOpenRouterKeyAction({ status: 'idle' }, form({ key: 'sk-or-v1-abcdef123456' }));
    expect(result.status).toBe('saved');
    expect(state.saved).toEqual([{ userId: 'user-1', plaintext: 'sk-or-v1-abcdef123456' }]);
  });

  it('rejects a blank submission without writing', async () => {
    const result = await saveOpenRouterKeyAction({ status: 'idle' }, form({ key: '   ' }));
    expect(result.status).toBe('error');
    expect(state.saved).toHaveLength(0);
  });

  it('surfaces a helper validation error', async () => {
    const result = await saveOpenRouterKeyAction({ status: 'idle' }, form({ key: 'short' }));
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/does not look like/i);
  });

  it('rejects when unauthenticated', async () => {
    state.user = null;
    await expect(
      saveOpenRouterKeyAction({ status: 'idle' }, form({ key: 'sk-or-v1-abcdef123456' })),
    ).rejects.toThrow(/sign-in/);
  });
});

describe('removeOpenRouterKeyAction', () => {
  it('removes the key', async () => {
    const result = await removeOpenRouterKeyAction({ status: 'idle' }, form({}));
    expect(result.status).toBe('removed');
    expect(state.removed).toEqual(['user-1']);
  });

  it('rejects when unauthenticated', async () => {
    state.user = null;
    await expect(removeOpenRouterKeyAction({ status: 'idle' }, form({}))).rejects.toThrow(/sign-in/);
  });
});
