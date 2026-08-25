import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mid-story turn mode switching (mode-switching capability) against a fake
 * database. Invariants under test: only owner/gm may switch, an unregistered
 * mode is rejected before anything is written, and every successful switch
 * writes exactly one append-only audit row while preserving unrelated
 * turn_config keys.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, string>(), // `${storyId}:${userId}` -> role
  stories: new Map<string, Record<string, unknown>>(),
  modeChanges: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const filters: Record<string, unknown> = {};

    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      order() {
        return builder;
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const role = state.members.get(`${filters.story_id}:${filters.user_id}`);
          return { data: role !== undefined ? { role } : null, error: null };
        }

        return { data: null, error: null };
      },
      async single() {
        if (table === 'stories') {
          const story = state.stories.get(filters.id as string);
          return { data: story ?? null, error: story === undefined ? { message: 'not found' } : null };
        }

        return { data: null, error: null };
      },
      update(values: Record<string, unknown>) {
        return {
          async eq(_column: string, value: unknown) {
            if (table === 'stories') {
              const existing = state.stories.get(value as string);
              if (existing !== undefined) {
                state.stories.set(value as string, { ...existing, ...values });
              }
            }
            return { error: null };
          },
        };
      },
      insert(values: Record<string, unknown>) {
        if (table === 'turn_mode_changes') {
          const row = {
            id: `change-${state.modeChanges.length + 1}`,
            created_at: `2026-08-22T00:00:0${state.modeChanges.length}Z`,
            ...values,
          };
          state.modeChanges.push(row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        }

        return { select: () => ({ single: async () => ({ data: values, error: null }) }) };
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        if (table === 'turn_mode_changes') {
          const rows = state.modeChanges
            .filter((row) => row.story_id === filters.story_id)
            .slice()
            .reverse();
          resolve({ data: rows, error: null });
          return;
        }

        resolve({ data: [], error: null });
      },
    };

    return builder;
  }

  return { createServiceRoleClient: () => ({ from }) };
});

const { switchTurnMode, listModeChanges, setPacing } = await import('@/lib/engine/mode-switching');

const STORY = 'story-1';
const OWNER = 'owner-1';
const GM = 'gm-1';
const PLAYER = 'player-1';

beforeEach(() => {
  state.members.clear();
  state.stories.clear();
  state.modeChanges.length = 0;

  state.members.set(`${STORY}:${OWNER}`, 'owner');
  state.members.set(`${STORY}:${GM}`, 'gm');
  state.members.set(`${STORY}:${PLAYER}`, 'player');

  state.stories.set(STORY, { id: STORY, turn_config: { absent_policy: 'skip' } });
});

describe('switchTurnMode', () => {
  it('owner can switch and turn_config.active_mode is updated', async () => {
    const change = await switchTurnMode(STORY, OWNER, 'action');

    expect(change.newMode).toBe('action');
    expect(change.previousMode).toBeNull();
    expect(state.stories.get(STORY)?.turn_config).toEqual({ absent_policy: 'skip', active_mode: 'action' });
  });

  it('gm can switch', async () => {
    const change = await switchTurnMode(STORY, GM, 'dialogue');
    expect(change.newMode).toBe('dialogue');
  });

  it('player is rejected and nothing is written', async () => {
    await expect(switchTurnMode(STORY, PLAYER, 'action')).rejects.toThrow();

    expect(state.stories.get(STORY)?.turn_config).toEqual({ absent_policy: 'skip' });
    expect(state.modeChanges).toHaveLength(0);
  });

  it('an unregistered mode name is rejected before writing', async () => {
    await expect(switchTurnMode(STORY, OWNER, 'tactical')).rejects.toThrow(/Unknown turn mode/);

    expect(state.stories.get(STORY)?.turn_config).toEqual({ absent_policy: 'skip' });
    expect(state.modeChanges).toHaveLength(0);
  });

  it('records previous and new mode across successive switches', async () => {
    const first = await switchTurnMode(STORY, OWNER, 'action');
    expect(first.previousMode).toBeNull();
    expect(first.newMode).toBe('action');

    const second = await switchTurnMode(STORY, OWNER, 'investigation');
    expect(second.previousMode).toBe('action');
    expect(second.newMode).toBe('investigation');

    expect(state.modeChanges).toHaveLength(2);
  });

  it('preserves unrelated turn_config keys', async () => {
    await switchTurnMode(STORY, OWNER, 'scene');

    expect(state.stories.get(STORY)?.turn_config).toMatchObject({ absent_policy: 'skip' });
  });
});

describe('setPacing', () => {
  it('owner can set pacing and turn_config.pacing is updated', async () => {
    await setPacing(STORY, OWNER, 'expansive');

    expect(state.stories.get(STORY)?.turn_config).toEqual({ absent_policy: 'skip', pacing: 'expansive' });
  });

  it('gm can set pacing', async () => {
    await expect(setPacing(STORY, GM, 'tight')).resolves.toBeUndefined();
    expect(state.stories.get(STORY)?.turn_config).toMatchObject({ pacing: 'tight' });
  });

  it('player is rejected and nothing is written', async () => {
    await expect(setPacing(STORY, PLAYER, 'tight')).rejects.toThrow();

    expect(state.stories.get(STORY)?.turn_config).toEqual({ absent_policy: 'skip' });
  });

  it('an unregistered pacing value is rejected before writing', async () => {
    await expect(setPacing(STORY, OWNER, 'breakneck')).rejects.toThrow(/Unknown pacing/);

    expect(state.stories.get(STORY)?.turn_config).toEqual({ absent_policy: 'skip' });
  });

  it('preserves unrelated turn_config keys, including active_mode', async () => {
    await switchTurnMode(STORY, OWNER, 'action');
    await setPacing(STORY, OWNER, 'tight');

    expect(state.stories.get(STORY)?.turn_config).toEqual({
      absent_policy: 'skip',
      active_mode: 'action',
      pacing: 'tight',
    });
  });
});

describe('listModeChanges', () => {
  it('returns switches most-recent-first', async () => {
    await switchTurnMode(STORY, OWNER, 'action');
    await switchTurnMode(STORY, OWNER, 'scene');

    const history = await listModeChanges(STORY, OWNER);

    expect(history).toHaveLength(2);
    expect(history[0]?.newMode).toBe('scene');
    expect(history[1]?.newMode).toBe('action');
  });

  it('any member, not just owner/gm, can read the history', async () => {
    await switchTurnMode(STORY, OWNER, 'action');

    await expect(listModeChanges(STORY, PLAYER)).resolves.toHaveLength(1);
  });
});
