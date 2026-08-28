import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Key resolution order (gm → owner → platform), decrypt round-trip, and the
 * defensive skip when a stored row is unreadable.
 */

// env.ts parses process.env at import time, so this must run before any import
// below pulls it in transitively.
process.env.ENCRYPTION_MASTER_KEY = randomBytes(32).toString('base64');
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.OPENROUTER_API_KEY = 'platform-key';
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.WORKER_SECRET ??= 'test-worker-secret-value';

vi.mock('server-only', () => ({}));

interface FakeRow {
  owner_id: string;
  scope: string;
  provider: string;
  encrypted_key: string;
  label: string | null;
  created_at: string;
}

const state = vi.hoisted(() => ({
  apiKeys: [] as FakeRow[],
  stories: [] as { id: string; owner_id: string }[],
  members: [] as { story_id: string; user_id: string; role: string }[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        limit() {
          return builder;
        },
        delete() {
          builder._delete = true;
          return builder;
        },
        insert(row: Partial<FakeRow>) {
          state.apiKeys.push({
            owner_id: row.owner_id!,
            scope: row.scope!,
            provider: row.provider!,
            encrypted_key: row.encrypted_key!,
            label: row.label ?? null,
            created_at: new Date().toISOString(),
          });
          return Promise.resolve({ error: null });
        },
        _delete: false,
        maybeSingle() {
          const rows = builder._rows();
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(resolve: (r: { data: unknown; error: null }) => void) {
          if (builder._delete) {
            if (table === 'api_keys') {
              state.apiKeys = state.apiKeys.filter((r) => !builder._match(r));
            }
            resolve({ data: null, error: null });
            return;
          }
          resolve({ data: builder._rows(), error: null });
        },
        _match(r: object) {
          return Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v);
        },
        _rows() {
          const source =
            table === 'api_keys' ? state.apiKeys : table === 'stories' ? state.stories : state.members;
          return (source as Record<string, unknown>[]).filter((r) => builder._match(r));
        },
      };
      return builder;
    },
  }),
}));

const { encryptSecret } = await import('@/lib/crypto');
const { resolveStoryApiKey, getUserApiKey, saveUserApiKey } = await import('@/lib/ai/api-key');

function keyRow(ownerId: string, plaintext: string): FakeRow {
  return {
    owner_id: ownerId,
    scope: 'user',
    provider: 'openrouter',
    encrypted_key: encryptSecret(plaintext),
    label: null,
    created_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  state.apiKeys = [];
  state.stories = [{ id: 'story-1', owner_id: 'owner-1' }];
  state.members = [{ story_id: 'story-1', user_id: 'gm-1', role: 'gm' }];
});

describe('resolveStoryApiKey', () => {
  it('uses the GM key when present', async () => {
    state.apiKeys = [keyRow('gm-1', 'gm-secret'), keyRow('owner-1', 'owner-secret')];
    const resolved = await resolveStoryApiKey('story-1');
    expect(resolved).toEqual({ key: 'gm-secret', source: 'gm' });
  });

  it('falls back to the owner key when the GM has none', async () => {
    state.apiKeys = [keyRow('owner-1', 'owner-secret')];
    const resolved = await resolveStoryApiKey('story-1');
    expect(resolved).toEqual({ key: 'owner-secret', source: 'owner' });
  });

  it('falls back to the platform key when neither has one', async () => {
    state.apiKeys = [];
    const resolved = await resolveStoryApiKey('story-1');
    expect(resolved).toEqual({ key: 'platform-key', source: 'platform' });
  });

  it('skips an unreadable stored row rather than throwing', async () => {
    state.apiKeys = [
      { ...keyRow('gm-1', 'unused'), encrypted_key: 'garbage.not.valid' },
      keyRow('owner-1', 'owner-secret'),
    ];
    const resolved = await resolveStoryApiKey('story-1');
    expect(resolved).toEqual({ key: 'owner-secret', source: 'owner' });
  });

  it('uses the owner key when there is no GM member at all', async () => {
    state.members = [];
    state.apiKeys = [keyRow('owner-1', 'owner-secret')];
    const resolved = await resolveStoryApiKey('story-1');
    expect(resolved).toEqual({ key: 'owner-secret', source: 'owner' });
  });
});

describe('saveUserApiKey', () => {
  it('replaces any existing row so only one remains', async () => {
    await saveUserApiKey('gm-1', 'sk-or-first-key-value');
    await saveUserApiKey('gm-1', 'sk-or-second-key-value');

    const rows = state.apiKeys.filter((r) => r.owner_id === 'gm-1');
    expect(rows).toHaveLength(1);

    const stored = await getUserApiKey('gm-1');
    expect(stored).not.toBeNull();
  });

  it('rejects an obviously-invalid key', async () => {
    await expect(saveUserApiKey('gm-1', 'short')).rejects.toThrow(/does not look like/i);
  });
});
