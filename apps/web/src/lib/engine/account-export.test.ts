import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  profiles: new Map<string, { username: string }>(),
  preferences: new Map<string, Record<string, unknown>>(),
  storyMembers: [] as Record<string, unknown>[],
  submissions: [] as Record<string, unknown>[],
  reports: [] as Record<string, unknown>[],
  usageLog: [] as Record<string, unknown>[],
  apiKeys: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        builder._filters[column] = value;
        return builder;
      },
      async maybeSingle() {
        if (table === 'profiles') {
          const row = state.profiles.get(builder._filters.id as string);
          return { data: row ?? null, error: null };
        }
        if (table === 'user_preferences') {
          const row = state.preferences.get(builder._filters.user_id as string);
          return { data: row ?? null, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve: (result: { data: unknown[]; error: null }) => void) {
        const filterKey = Object.keys(builder._filters)[0] ?? '';
        const filterValue = builder._filters[filterKey];

        const tableData: Record<string, Record<string, unknown>[]> = {
          story_members: state.storyMembers,
          submissions: state.submissions,
          story_reports: state.reports,
          usage_log: state.usageLog,
          api_keys: state.apiKeys,
        };

        const rows = (tableData[table] ?? []).filter((row) => row[filterKey] === filterValue);
        resolve({ data: rows, error: null });
      },
    };

    return builder;
  }

  return {
    createServiceRoleClient: () => ({ from }),
  };
});

const { requestAccountExport } = await import('@/lib/engine/account-export');

const USER = 'user-1';
const OTHER_USER = 'user-2';
const STORY = 'story-1';

beforeEach(() => {
  state.profiles.clear();
  state.preferences.clear();
  state.storyMembers.length = 0;
  state.submissions.length = 0;
  state.reports.length = 0;
  state.usageLog.length = 0;
  state.apiKeys.length = 0;
});

describe('requestAccountExport', () => {
  it('returns empty collections for a user with no history', async () => {
    const result = await requestAccountExport(USER);

    expect(result.profile).toBeNull();
    expect(result.preferences).toBeNull();
    expect(result.storyMemberships).toEqual([]);
    expect(result.submissions).toEqual([]);
    expect(result.reportsFiled).toEqual([]);
    expect(result.usageHistory).toEqual([]);
    expect(result.apiKeys).toEqual([]);
    expect(result.userId).toBe(USER);
  });

  it('includes the requesting user\'s own data across every category', async () => {
    state.profiles.set(USER, { username: 'kestrel' });
    state.preferences.set(USER, {
      user_id: USER,
      theme_preset: 'dark-arcane',
      accent_hue: 300,
      font_pairing: 'cinzel-spectral',
      text_scale: 2,
    });
    state.storyMembers.push({
      user_id: USER,
      story_id: STORY,
      role: 'player',
      joined_at: '2026-08-01T00:00:00Z',
      stories: { title: 'The Long Watch' },
    });
    state.submissions.push({
      id: 'sub-1',
      user_id: USER,
      story_id: STORY,
      turn_id: 'turn-1',
      content: 'I draw my sword.',
      submitted_at: '2026-08-01T00:00:00Z',
    });
    state.reports.push({
      id: 'report-1',
      reporter_id: USER,
      story_id: STORY,
      chapter_id: 'chapter-1',
      submission_id: null,
      reason: 'Off-topic.',
      status: 'open',
      created_at: '2026-08-01T00:00:00Z',
    });
    state.usageLog.push({
      user_id: USER,
      story_id: STORY,
      role: 'narrator',
      model: 'test-model',
      prompt_tokens: 100,
      completion_tokens: 50,
      cost_usd: 0.01,
      succeeded: true,
      created_at: '2026-08-01T00:00:00Z',
    });
    state.apiKeys.push({
      owner_id: USER,
      scope: 'user',
      story_id: null,
      label: 'My key',
      created_at: '2026-08-01T00:00:00Z',
      encrypted_key: 'super-secret-ciphertext',
    });

    const result = await requestAccountExport(USER);

    expect(result.profile).toEqual({ username: 'kestrel' });
    expect(result.storyMemberships).toEqual([
      { storyId: STORY, storyTitle: 'The Long Watch', role: 'player', joinedAt: '2026-08-01T00:00:00Z' },
    ]);
    expect(result.submissions).toHaveLength(1);
    expect(result.reportsFiled).toHaveLength(1);
    expect(result.usageHistory).toHaveLength(1);
    expect(result.apiKeys).toEqual([
      { scope: 'user', storyId: null, label: 'My key', createdAt: '2026-08-01T00:00:00Z' },
    ]);
  });

  it('never includes the encrypted key ciphertext', async () => {
    state.apiKeys.push({
      owner_id: USER,
      scope: 'user',
      story_id: null,
      label: 'My key',
      created_at: '2026-08-01T00:00:00Z',
      encrypted_key: 'super-secret-ciphertext',
    });

    const result = await requestAccountExport(USER);

    expect(JSON.stringify(result)).not.toContain('super-secret-ciphertext');
  });

  it("excludes another member's submissions and identity", async () => {
    state.submissions.push(
      { id: 'sub-mine', user_id: USER, story_id: STORY, turn_id: 'turn-1', content: 'Mine.', submitted_at: '2026-08-01T00:00:00Z' },
      { id: 'sub-other', user_id: OTHER_USER, story_id: STORY, turn_id: 'turn-1', content: 'Theirs.', submitted_at: '2026-08-01T00:00:00Z' },
    );

    const result = await requestAccountExport(USER);

    expect(result.submissions).toHaveLength(1);
    expect(result.submissions[0]?.content).toBe('Mine.');
    expect(JSON.stringify(result)).not.toContain('Theirs.');
    expect(JSON.stringify(result)).not.toContain(OTHER_USER);
  });
});
