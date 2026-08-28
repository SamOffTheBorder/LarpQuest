import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The per-role model override action: sets several roles, clears blanks,
 * ignores unknown form fields, and refuses a non-owner/GM.
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
  role: 'owner' as string | null,
  modelConfig: {} as Record<string, string>,
  saved: null as Record<string, string> | null,
}));

vi.mock('@/lib/auth', () => ({ requireUser: async () => ({ id: 'user-1' }) }));

vi.mock('@/lib/engine/stories', () => ({
  getStory: async () => {
    if (state.role === null) throw new Error('Story not found.');
    return { modelConfig: state.modelConfig };
  },
  updateStoryModelConfig: async (_id: string, _uid: string, config: Record<string, string>) => {
    if (state.role !== 'owner' && state.role !== 'gm') {
      throw new Error('Story not found.');
    }
    state.saved = config;
    return { modelConfig: config };
  },
}));

const { updateModelOverridesAction } = await import('@/app/stories/[storyId]/settings-actions');

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  state.role = 'owner';
  state.modelConfig = {};
  state.saved = null;
});

describe('updateModelOverridesAction', () => {
  it('sets several roles', async () => {
    const result = await updateModelOverridesAction(
      'story-1',
      { status: 'idle' },
      form({ narrator: 'a/narrator:free', gatekeeper: 'b/gate:free' }),
    );
    expect(result.status).toBe('idle');
    expect(state.saved).toEqual({ narrator: 'a/narrator:free', gatekeeper: 'b/gate:free' });
  });

  it('clears a role when its field is blank', async () => {
    state.modelConfig = { narrator: 'old/model', extractor: 'keep/model' };
    await updateModelOverridesAction(
      'story-1',
      { status: 'idle' },
      form({ narrator: '', extractor: 'keep/model' }),
    );
    expect(state.saved).toEqual({ extractor: 'keep/model' });
  });

  it('ignores a form field that is not a configurable role', async () => {
    await updateModelOverridesAction(
      'story-1',
      { status: 'idle' },
      form({ narrator: 'a/model', embedder: 'should/be-ignored', bogus: 'x' }),
    );
    expect(state.saved).toEqual({ narrator: 'a/model' });
  });

  it('returns an error for a non-owner/GM', async () => {
    state.role = 'player';
    const result = await updateModelOverridesAction(
      'story-1',
      { status: 'idle' },
      form({ narrator: 'a/model' }),
    );
    expect(result.status).toBe('error');
    expect(state.saved).toBeNull();
  });
});
