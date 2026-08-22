import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Usernames against a fake profiles table. The case-insensitive uniqueness
 * index is simulated by the mock, since the real constraint lives in Postgres.
 */

const state = vi.hoisted(() => ({
  profiles: new Map<string, { id: string; username: string }>(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(_table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      _in: undefined as { column: string; values: unknown[] } | undefined,
      _upsert: undefined as Record<string, unknown> | undefined,
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        builder._filters[column] = value;
        return builder;
      },
      in(column: string, values: unknown[]) {
        builder._in = { column, values };
        return builder;
      },
      upsert(payload: Record<string, unknown>) {
        builder._upsert = payload;
        return builder;
      },
      async maybeSingle() {
        const row = state.profiles.get(builder._filters.id as string);
        return { data: row ?? null, error: null };
      },
      async single() {
        const payload = builder._upsert;

        if (payload === undefined) {
          return { data: null, error: null };
        }

        const id = payload.id as string;
        const username = payload.username as string;

        // profiles_username_lower_idx: same name, different account, collides.
        const taken = [...state.profiles.values()].some(
          (row) => row.id !== id && row.username.toLowerCase() === username.toLowerCase(),
        );

        if (taken) {
          return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }

        const row = { id, username };
        state.profiles.set(id, row);
        return { data: row, error: null };
      },
      then(resolve: (result: { data: unknown; error: null }) => void) {
        const values = (builder._in?.values ?? []) as string[];
        const rows = values
          .map((id) => state.profiles.get(id))
          .filter((row): row is { id: string; username: string } => row !== undefined);

        resolve({ data: rows, error: null });
        return Promise.resolve({ data: rows, error: null });
      },
    };

    return builder;
  }

  return { createServiceRoleClient: () => ({ from }) };
});

const { getProfile, setUsername, getUsernames, fallbackName, UsernameTakenError } = await import(
  '@/lib/engine/profiles'
);

beforeEach(() => {
  state.profiles.clear();
});

describe('setUsername', () => {
  it('sets a username and reads it back', async () => {
    await setUsername('user-1', 'storyweaver');
    expect(await getProfile('user-1')).toEqual({ id: 'user-1', username: 'storyweaver' });
  });

  it('renames the same account without a collision against itself', async () => {
    await setUsername('user-1', 'storyweaver');
    await setUsername('user-1', 'Storyweaver');
    expect((await getProfile('user-1'))?.username).toBe('Storyweaver');
  });

  it('rejects a name another account already holds, ignoring case', async () => {
    await setUsername('user-1', 'storyweaver');
    await expect(setUsername('user-2', 'StoryWeaver')).rejects.toThrow(UsernameTakenError);
  });

  it.each([['ab'], ['a'.repeat(33)], ['has space'], ['bad!char'], ['']])(
    'rejects the invalid username %j',
    async (candidate) => {
      await expect(setUsername('user-1', candidate)).rejects.toThrow();
    },
  );

  it('trims surrounding whitespace rather than rejecting it', async () => {
    await setUsername('user-1', '  storyweaver  ');
    expect((await getProfile('user-1'))?.username).toBe('storyweaver');
  });
});

describe('getProfile', () => {
  it('returns null for an account with no username set', async () => {
    expect(await getProfile('nobody')).toBeNull();
  });
});

describe('getUsernames', () => {
  it('resolves many ids at once, omitting accounts with no profile', async () => {
    await setUsername('user-1', 'alice');
    await setUsername('user-2', 'bob');

    const names = await getUsernames(['user-1', 'user-2', 'user-3']);

    expect(names.get('user-1')).toBe('alice');
    expect(names.get('user-2')).toBe('bob');
    expect(names.has('user-3')).toBe(false);
  });

  it('short-circuits on an empty id list', async () => {
    expect((await getUsernames([])).size).toBe(0);
  });
});

describe('fallbackName', () => {
  it('keeps two unnamed accounts distinguishable without exposing the whole id', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(fallbackName(id)).toBe('Player 11111111');
    expect(fallbackName(id)).not.toContain('555555555555');
  });
});
