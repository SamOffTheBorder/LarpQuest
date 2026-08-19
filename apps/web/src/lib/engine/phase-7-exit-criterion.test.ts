import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Proof of Phase 7's exit criterion (build plan Part 9): "A story might run
 * `scene` for setup, `investigation` for the middle, `action` for the
 * climax." This test drives `openTurn` and `switchTurnMode` together against
 * one fake database to prove the actual arc: a story opens turns in one
 * mode, a GM switches mode mid-story, and every already-created turn keeps
 * the mode it was created with while the next turn adopts the new one — with
 * the switch itself recorded and rejected for a non-GM caller. Full chapter
 * generation is already covered by turns.test.ts; this test is scoped to
 * the mode-resolution-plus-switching mechanism itself.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, string>(), // `${storyId}:${userId}` -> role
  stories: new Map<string, Record<string, unknown>>(),
  turns: new Map<string, Record<string, unknown>>(),
  modeChanges: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }),
  clientEnv: {},
}));

vi.mock('@/lib/ai/usage', () => ({
  createUsageRecorder: () => ({ record: async () => {} }),
}));

vi.mock('@/lib/memory/retrieval', () => ({
  retrieveRelevantSummaries: async () => [],
}));

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
          const row = { id: `change-${state.modeChanges.length + 1}`, created_at: 'now', ...values };
          state.modeChanges.push(row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        }

        return { select: () => ({ single: async () => ({ data: values, error: null }) }) };
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        if (table === 'turn_mode_changes') {
          const rows = state.modeChanges.filter((row) => row.story_id === filters.story_id).slice().reverse();
          resolve({ data: rows, error: null });
          return;
        }

        resolve({ data: [], error: null });
      },
    };

    return builder;
  }

  return {
    createServiceRoleClient: () => ({
      from,
      async rpc(name: string, args: Record<string, unknown>) {
        if (name === 'open_turn') {
          const id = `turn-${state.turns.size + 1}`;
          const row = {
            id,
            story_id: args.p_story_id,
            turn_number: state.turns.size + 1,
            mode: args.p_mode,
            status: 'open',
          };
          state.turns.set(id, row);
          return { data: row, error: null };
        }

        return { data: null, error: null };
      },
    }),
    createClient: async () => ({}),
  };
});

const { openTurn } = await import('@/lib/engine/turns');
const { switchTurnMode } = await import('@/lib/engine/mode-switching');

const STORY = 'story-1';
const GM = 'gm-1';
const PLAYER = 'player-1';

beforeEach(() => {
  state.members.clear();
  state.stories.clear();
  state.turns.clear();
  state.modeChanges.length = 0;

  state.members.set(`${STORY}:${GM}`, 'gm');
  state.members.set(`${STORY}:${PLAYER}`, 'player');
  state.stories.set(STORY, { id: STORY, turn_config: { active_mode: 'scene' } });
});

describe('Phase 7 exit criterion: a story runs different modes across its arc', () => {
  it('opens in scene mode, switches to investigation, then action — each turn keeps its own creation-time mode', async () => {
    const sceneTurn = await openTurn(STORY, GM);
    expect(sceneTurn.mode).toBe('scene');

    await switchTurnMode(STORY, GM, 'investigation');
    const investigationTurn = await openTurn(STORY, GM);
    expect(investigationTurn.mode).toBe('investigation');

    await switchTurnMode(STORY, GM, 'action');
    const actionTurn = await openTurn(STORY, GM);
    expect(actionTurn.mode).toBe('action');

    // No retroactive change: turns already created keep their own mode.
    expect(state.turns.get(sceneTurn.id)?.mode).toBe('scene');
    expect(state.turns.get(investigationTurn.id)?.mode).toBe('investigation');
  });

  it('records every switch in the audit trail with correct previous/new chaining', async () => {
    await openTurn(STORY, GM);
    await switchTurnMode(STORY, GM, 'investigation');
    await switchTurnMode(STORY, GM, 'action');

    expect(state.modeChanges).toHaveLength(2);
    expect(state.modeChanges[0]).toMatchObject({ previous_mode: 'scene', new_mode: 'investigation' });
    expect(state.modeChanges[1]).toMatchObject({ previous_mode: 'investigation', new_mode: 'action' });
  });

  it('a player cannot switch the story mode', async () => {
    await expect(switchTurnMode(STORY, PLAYER, 'action')).rejects.toThrow();

    expect(state.modeChanges).toHaveLength(0);
    expect(state.stories.get(STORY)?.turn_config).toEqual({ active_mode: 'scene' });
  });
});
