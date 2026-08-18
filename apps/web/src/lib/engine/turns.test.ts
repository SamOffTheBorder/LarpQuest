import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Turn loop behavior against a fake database.
 *
 * The invariant under test is the one the whole design rests on: no generation
 * outcome may delete or alter a submission. The fake records every write, so a
 * test can assert that a failure path touched `turns` and nothing else.
 */

const state = vi.hoisted(() => ({
  turns: new Map<string, Record<string, unknown>>(),
  submissions: [] as Record<string, unknown>[],
  members: new Set<string>(),
  /** Every table mutated, in order. Submissions must never appear. */
  writes: [] as { table: string; op: string }[],
  narrationBehavior: 'succeed' as 'succeed' | 'throw' | 'incomplete',
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }),
  clientEnv: {},
}));

vi.mock('@/lib/ai/usage', () => ({
  createUsageRecorder: () => ({ record: async () => {} }),
}));

// Retrieval (Phase 4) is exercised in its own test file (retrieval.test.ts) —
// here it only needs to not attempt a real embedding call, since this file's
// invariant is about the turn loop's submission-persistence guarantee, not
// retrieval ranking.
vi.mock('@/lib/memory/retrieval', () => ({
  retrieveRelevantSummaries: async () => [],
}));

vi.mock('@/lib/ai/gateway', () => ({
  streamNarration: async (
    _deps: unknown,
    args: { onChunk: (text: string) => void },
  ) => {
    args.onChunk('partial prose so far');

    if (state.narrationBehavior === 'throw') {
      throw new Error('provider exploded mid-stream');
    }

    if (state.narrationBehavior === 'incomplete') {
      return {
        prose: 'partial prose so far',
        resolvedModel: 'm',
        usedFallbackModel: false,
        completed: false,
      };
    }

    return {
      prose: 'A complete chapter.',
      resolvedModel: 'm',
      usedFallbackModel: false,
      completed: true,
    };
  },
}));

function turnRow(id: string) {
  return state.turns.get(id) ?? null;
}

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
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      insert(values: Record<string, unknown>) {
        state.writes.push({ table, op: 'insert' });

        if (table === 'submissions') {
          const row = { id: `sub-${state.submissions.length + 1}`, ...values };
          state.submissions.push(row);
          return {
            select: () => ({ single: async () => ({ data: row, error: null }) }),
          };
        }

        return { select: () => ({ single: async () => ({ data: values, error: null }) }) };
      },
      update(values: Record<string, unknown>) {
        state.writes.push({ table, op: 'update' });

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
            const existing = turnRow(id);

            if (existing === null) {
              return { data: null, error: null };
            }

            // Honour the optimistic status guard the real query uses.
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
          then(resolve: (v: { error: null }) => void) {
            const id = updateBuilder._eq.id as string;
            const existing = turnRow(id);

            if (existing !== null) {
              state.turns.set(id, { ...existing, ...values });
            }

            resolve({ error: null });
          },
        };

        return updateBuilder;
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const key = `${builder._filters.story_id}:${builder._filters.user_id}`;
          return {
            data: state.members.has(key) ? { user_id: builder._filters.user_id } : null,
            error: null,
          };
        }

        if (table === 'turns') {
          return { data: turnRow(builder._filters.id as string), error: null };
        }

        if (table === 'submissions') {
          const found = state.submissions.find((row) => row.id === builder._filters.id);
          return { data: found ?? null, error: null };
        }

        return { data: null, error: null };
      },
      async single() {
        if (table === 'stories') {
          return {
            data: {
              title: 'Test Story',
              world_ledger: {},
              model_config: null,
              turn_config: {},
            },
            error: null,
          };
        }

        return { data: null, error: null };
      },
      then(resolve: (v: { data: unknown[]; error: null; count?: number }) => void) {
        if (table === 'submissions') {
          const rows = state.submissions.filter(
            (row) => row.turn_id === builder._filters.turn_id,
          );
          resolve({ data: rows, error: null, count: rows.length });
          return;
        }

        resolve({ data: [], error: null, count: 0 });
      },
    };

    return builder;
  }

  return {
    createServiceRoleClient: () => ({
      from,
      async rpc(name: string, args: Record<string, unknown>) {
        state.writes.push({ table: `rpc:${name}`, op: 'call' });

        if (name === 'publish_chapter') {
          const id = args.p_turn_id as string;
          const existing = turnRow(id);
          state.turns.set(id, { ...existing, status: 'published' });
          return { data: { id: 'chapter-1', turn_number: 1 }, error: null };
        }

        return { data: null, error: null };
      },
    }),
    createClient: async () => ({}),
  };
});

const STORY = 'story-1';
const USER = 'user-1';
const TURN = 'turn-1';

beforeEach(() => {
  state.turns.clear();
  state.submissions.length = 0;
  state.writes.length = 0;
  state.members.clear();
  state.members.add(`${STORY}:${USER}`);
  state.narrationBehavior = 'succeed';

  state.turns.set(TURN, {
    id: TURN,
    story_id: STORY,
    turn_number: 1,
    mode: 'freeform',
    scene_setup: null,
    status: 'open',
    partial_prose: null,
    failure_reason: null,
    attempt_count: 0,
  });
});

describe('submissions', () => {
  it('accepts a submission while the turn is open', async () => {
    const { createSubmission } = await import('@/lib/engine/turns');

    const submission = await createSubmission(TURN, USER, {
      content: 'I search the ruin.',
      entityId: null,
    });

    expect(submission.content).toBe('I search the ruin.');
    expect(state.submissions).toHaveLength(1);
  });

  it('rejects a submission once the turn is locked', async () => {
    const { createSubmission } = await import('@/lib/engine/turns');

    state.turns.set(TURN, { ...turnRow(TURN), status: 'locked' });

    await expect(
      createSubmission(TURN, USER, { content: 'Too late.', entityId: null }),
    ).rejects.toThrow(/locked/);
  });

  it('rejects an empty submission before any database work', async () => {
    const { createSubmission } = await import('@/lib/engine/turns');

    await expect(
      createSubmission(TURN, USER, { content: '   ', entityId: null }),
    ).rejects.toThrow();

    expect(state.writes).toHaveLength(0);
  });
});

describe('lock', () => {
  it('rejects a lock with no submissions', async () => {
    const { lockTurn } = await import('@/lib/engine/turns');

    await expect(lockTurn(TURN, USER)).rejects.toThrow(/no submissions/);
    expect(turnRow(TURN)?.status).toBe('open');
  });

  it('locks an open turn that has a submission', async () => {
    const { createSubmission, lockTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I wait.', entityId: null });
    const locked = await lockTurn(TURN, USER);

    expect(locked.status).toBe('locked');
  });

  it('rejects an invalid transition', async () => {
    const { lockTurn } = await import('@/lib/engine/turns');

    state.turns.set(TURN, { ...turnRow(TURN), status: 'published' });

    await expect(lockTurn(TURN, USER)).rejects.toThrow(/Invalid turn transition/);
  });
});

describe('generation failure', () => {
  it('preserves submissions when generation throws', async () => {
    const { createSubmission, lockTurn, generateTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I climb the tower.', entityId: null });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'throw';
    state.writes.length = 0;

    await expect(generateTurn(TURN, USER)).rejects.toThrow(/exploded/);

    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0]?.content).toBe('I climb the tower.');

    // The failure path must not have written to submissions at all.
    expect(state.writes.filter((w) => w.table === 'submissions')).toHaveLength(0);
  });

  it('retains partial prose and the reason on the failed turn', async () => {
    const { createSubmission, lockTurn, generateTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I run.', entityId: null });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'throw';
    await expect(generateTurn(TURN, USER)).rejects.toThrow();

    const failed = turnRow(TURN);
    expect(failed?.status).toBe('failed');
    expect(failed?.partial_prose).toBe('partial prose so far');
    expect(failed?.failure_reason).toMatch(/exploded/);
  });

  it('treats an incomplete stream as a failure but keeps the prose', async () => {
    const { createSubmission, lockTurn, generateTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I listen.', entityId: null });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'incomplete';
    await expect(generateTurn(TURN, USER)).rejects.toThrow(/ended before completing/);

    expect(turnRow(TURN)?.partial_prose).toBe('partial prose so far');
    expect(state.submissions).toHaveLength(1);
  });

  it('survives repeated failures with submissions intact', async () => {
    const { createSubmission, lockTurn, generateTurn, retryTurn } = await import(
      '@/lib/engine/turns'
    );

    await createSubmission(TURN, USER, { content: 'I hold the line.', entityId: null });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'throw';

    await expect(generateTurn(TURN, USER)).rejects.toThrow();
    await expect(retryTurn(TURN, USER)).rejects.toThrow();
    await expect(retryTurn(TURN, USER)).rejects.toThrow();

    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0]?.content).toBe('I hold the line.');
    expect(turnRow(TURN)?.attempt_count).toBe(3);
  });
});

describe('retry', () => {
  it('reuses the original submissions and can succeed', async () => {
    const { createSubmission, lockTurn, generateTurn, retryTurn } = await import(
      '@/lib/engine/turns'
    );

    await createSubmission(TURN, USER, { content: 'I parley.', entityId: null });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'throw';
    await expect(generateTurn(TURN, USER)).rejects.toThrow();

    state.narrationBehavior = 'succeed';
    const result = await retryTurn(TURN, USER);

    expect(result.prose).toBe('A complete chapter.');
    expect(turnRow(TURN)?.status).toBe('published');
    // The submission was never rewritten — same row, same text.
    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0]?.content).toBe('I parley.');
  });

  it('refuses to retry a turn that is not failed', async () => {
    const { retryTurn } = await import('@/lib/engine/turns');

    await expect(retryTurn(TURN, USER)).rejects.toThrow(/only a failed turn/);
  });
});

describe('membership', () => {
  it('refuses a non-member before any write', async () => {
    const { createSubmission } = await import('@/lib/engine/turns');

    await expect(
      createSubmission(TURN, 'intruder', { content: 'let me in', entityId: null }),
    ).rejects.toThrow(/not found or not accessible/);

    expect(state.submissions).toHaveLength(0);
  });
});
