import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Deadline sweep against a fake turns/stories/entities/submissions table.
 * Covers the three absent_policy branches and the "no deadline set" no-op —
 * turns.deadline existed in the schema since Phase 1 but nothing read it
 * until this phase.
 */

const state = vi.hoisted(() => ({
  turns: new Map<string, Record<string, unknown>>(),
  stories: new Map<string, Record<string, unknown>>(),
  members: new Map<string, { role: string }>(), // key: `${storyId}:${userId}`
  entities: new Map<string, Record<string, unknown>>(),
  submissions: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }),
  clientEnv: {},
}));

class FakeStructuredOutputError extends Error {}

vi.mock('@/lib/ai/gateway', () => ({
  StructuredOutputError: FakeStructuredOutputError,
  callStructured: async () => ({
    data: { verdict: 'pass', reason: 'ok' },
    resolvedModel: 'm',
    usedFallbackModel: false,
  }),
}));

vi.mock('@/lib/ai/usage', () => ({
  createUsageRecorder: () => ({ record: async () => {} }),
}));

// Retrieval and narration are exercised by turns.test.ts; this file's
// invariant is deadline/absent-policy behavior, not generation itself, and
// no test here reaches the generating state.
vi.mock('@/lib/memory/retrieval', () => ({
  retrieveRelevantSummaries: async () => [],
}));

function ownerOf(storyId: string): string | undefined {
  for (const [key, value] of state.members) {
    const [sid, uid] = key.split(':');
    if (sid === storyId && value.role === 'owner') {
      return uid;
    }
  }
  return undefined;
}

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      _notFilters: {} as Record<string, unknown>,
      _ltFilters: {} as Record<string, unknown>,
      select() {
        return builder;
      },
      order() {
        return builder;
      },
      eq(column: string, value: unknown) {
        builder._filters[column] = value;
        return builder;
      },
      not(column: string, _op: string, value: unknown) {
        builder._notFilters[column] = value;
        return builder;
      },
      lt(column: string, value: unknown) {
        builder._ltFilters[column] = value;
        return builder;
      },
      insert(values: Record<string, unknown>) {
        if (table === 'submissions') {
          const row = { id: `sub-${state.submissions.length + 1}`, ...values };
          state.submissions.push(row);
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: null });
      },
      update(values: Record<string, unknown>) {
        const updateBuilder = {
          _eq: {} as Record<string, unknown>,
          eq(column: string, value: unknown) {
            updateBuilder._eq[column] = value;
            return updateBuilder;
          },
          select() {
            return updateBuilder;
          },
          async maybeSingle() {
            const id = updateBuilder._eq.id as string;
            const existing = state.turns.get(id);
            if (existing === null || existing === undefined) {
              return { data: null, error: null };
            }
            if (
              updateBuilder._eq.status !== undefined &&
              existing.status !== updateBuilder._eq.status
            ) {
              return { data: null, error: null };
            }
            const next = { ...existing, ...values };
            state.turns.set(id, next);
            return { data: next, error: null };
          },
        };
        return updateBuilder;
      },
      async single() {
        if (table === 'stories') {
          const row = state.stories.get(builder._filters.id as string);
          return { data: row ?? null, error: row === undefined ? { message: 'not found' } : null };
        }
        if (table === 'story_members') {
          const uid = ownerOf(builder._filters.story_id as string);
          return { data: uid !== undefined ? { user_id: uid } : null, error: uid === undefined ? { message: 'no owner' } : null };
        }
        return { data: null, error: null };
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const key = `${builder._filters.story_id}:${builder._filters.user_id}`;
          const role = state.members.get(key);
          return { data: role !== undefined ? { role: role.role } : null, error: null };
        }
        if (table === 'turns') {
          return { data: state.turns.get(builder._filters.id as string) ?? null, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve: (result: { data: unknown[]; error: null; count?: number }) => void) {
        if (table === 'turns') {
          const rows = [...state.turns.values()].filter((turn) => {
            if (builder._filters.status !== undefined && turn.status !== builder._filters.status) {
              return false;
            }
            if ('deadline' in builder._notFilters && turn.deadline === null) {
              return false;
            }
            if ('deadline' in builder._ltFilters) {
              const deadline = turn.deadline as string | null;
              if (deadline === null || deadline >= (builder._ltFilters.deadline as string)) {
                return false;
              }
            }
            return true;
          });
          resolve({ data: rows, error: null });
          return;
        }

        if (table === 'entities') {
          const rows = [...state.entities.values()].filter((entity) => {
            if (builder._filters.story_id !== undefined && entity.story_id !== builder._filters.story_id) {
              return false;
            }
            if ('controlled_by' in builder._notFilters && entity.controlled_by === null) {
              return false;
            }
            return true;
          });
          resolve({ data: rows, error: null });
          return;
        }

        if (table === 'submissions') {
          const rows = state.submissions.filter((row) => row.turn_id === builder._filters.turn_id);
          resolve({ data: rows, error: null, count: rows.length });
          return;
        }

        resolve({ data: [], error: null });
      },
    };

    return builder;
  }

  return {
    createServiceRoleClient: () => ({ from }),
  };
});

const { sweepDeadlines } = await import('@/lib/engine/deadlines');

const STORY = 'story-1';
const TURN = 'turn-1';
const OWNER = 'owner-1';
const PAST = new Date(Date.now() - 60_000).toISOString();
const FUTURE = new Date(Date.now() + 60_000).toISOString();

function turnRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TURN,
    story_id: STORY,
    status: 'open',
    deadline: PAST,
    ...overrides,
  };
}

beforeEach(() => {
  state.turns.clear();
  state.stories.clear();
  state.members.clear();
  state.entities.clear();
  state.submissions.length = 0;

  state.members.set(`${STORY}:${OWNER}`, { role: 'owner' });
  state.stories.set(STORY, { turn_config: {} });
});

describe('sweepDeadlines', () => {
  it('a turn with no deadline set is untouched', async () => {
    state.turns.set(TURN, turnRow({ deadline: null }));

    const outcome = await sweepDeadlines();

    expect(outcome.checked).toBe(0);
    expect(state.turns.get(TURN)?.status).toBe('open');
  });

  it('a turn whose deadline has not yet passed is untouched', async () => {
    state.turns.set(TURN, turnRow({ deadline: FUTURE }));

    const outcome = await sweepDeadlines();

    expect(outcome.checked).toBe(0);
    expect(state.turns.get(TURN)?.status).toBe('open');
  });

  it('skip policy locks with existing submissions only', async () => {
    state.turns.set(TURN, turnRow());
    state.entities.set('entity-1', { id: 'entity-1', story_id: STORY, name: 'Aria', controlled_by: 'player-1' });
    state.submissions.push({ id: 'sub-1', turn_id: TURN, entity_id: 'entity-1', content: 'I act.' });
    state.stories.set(STORY, { turn_config: { absent_policy: 'skip' } });

    const outcome = await sweepDeadlines();

    expect(outcome.locked).toBe(1);
    expect(state.turns.get(TURN)?.status).toBe('locked');
    expect(state.submissions).toHaveLength(1); // no placeholder added
  });

  it('ai_plays generates a placeholder for unsubmitted claimed entities, then locks', async () => {
    state.turns.set(TURN, turnRow());
    state.entities.set('entity-1', { id: 'entity-1', story_id: STORY, name: 'Aria', controlled_by: 'player-1' });
    state.entities.set('entity-2', { id: 'entity-2', story_id: STORY, name: 'Bram', controlled_by: 'player-2' });
    state.submissions.push({ id: 'sub-1', turn_id: TURN, entity_id: 'entity-1', content: 'I act.' });
    state.stories.set(STORY, { turn_config: { absent_policy: 'ai_plays' } });

    const outcome = await sweepDeadlines();

    expect(outcome.locked).toBe(1);
    expect(state.turns.get(TURN)?.status).toBe('locked');
    expect(state.submissions).toHaveLength(2);
    expect(state.submissions[1]).toMatchObject({ entity_id: 'entity-2', user_id: 'player-2' });
    expect(state.submissions[1]?.content).toContain('Bram waits');
  });

  it('block policy leaves the turn open', async () => {
    state.turns.set(TURN, turnRow());
    state.stories.set(STORY, { turn_config: { absent_policy: 'block' } });

    const outcome = await sweepDeadlines();

    expect(outcome.blocked).toBe(1);
    expect(state.turns.get(TURN)?.status).toBe('open');
  });

  it('skip with zero submissions and zero claimed entities stays open (lock-with-no-submissions guard)', async () => {
    state.turns.set(TURN, turnRow());
    state.stories.set(STORY, { turn_config: { absent_policy: 'skip' } });

    const outcome = await sweepDeadlines();

    expect(outcome.blocked).toBe(1);
    expect(state.turns.get(TURN)?.status).toBe('open');
  });
});
