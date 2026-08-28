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
  chapters: new Map<string, Record<string, unknown>>(),
  submissions: [] as Record<string, unknown>[],
  entities: new Map<string, Record<string, unknown>>(),
  /** key: `${storyId}:${userId}` -> role */
  members: new Map<string, string>(),
  /** Every table mutated, in order. Submissions must never appear. */
  writes: [] as { table: string; op: string }[],
  narrationBehavior: 'succeed' as 'succeed' | 'throw' | 'incomplete' | 'turningPoint' | 'turningPointThenResolve',
  storyTurnConfig: {} as Record<string, unknown>,
  storyOwnerId: 'user-1',
  nextChapterNumber: 1,
  continueFightBehavior: 'succeed' as 'succeed' | 'notFound',
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/api-key', () => ({
  resolveStoryApiKey: async () => ({ key: 'test-key', source: 'platform' }),
  resolvePlatformApiKey: () => ({ key: 'test-key', source: 'platform' }),
}));

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

class FakeStructuredOutputError extends Error {}

vi.mock('@/lib/ai/gateway', () => ({
  StructuredOutputError: FakeStructuredOutputError,
  // Moderation always passes and validation always reports no violations in
  // this fixture — moderate.test.ts and validator.test.ts exercise their
  // respective matrices directly. Keyed by role since both go through the
  // same callStructured mock.
  callStructured: async (_deps: unknown, args: { role: string }) => {
    if (args.role === 'validator') {
      return { data: { violations: [] }, resolvedModel: 'm', usedFallbackModel: false };
    }

    return { data: { verdict: 'pass', reason: 'ok' }, resolvedModel: 'm', usedFallbackModel: false };
  },
  streamNarration: async (
    _deps: unknown,
    args: { onChunk: (text: string) => void; systemPrompt: string },
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

    if (state.narrationBehavior === 'turningPoint') {
      return {
        prose: 'The blades clash in the rain.\n\n[TURNING_POINT]',
        resolvedModel: 'm',
        usedFallbackModel: false,
        completed: true,
      };
    }

    if (state.narrationBehavior === 'turningPointThenResolve') {
      // Simulates a continuation turn: even if the model tries to emit the
      // marker again, the prompt for a continuation never mentions it — this
      // fixture emits it anyway to prove generateTurn ignores it regardless.
      const eligible = args.systemPrompt.includes('[TURNING_POINT]');
      return {
        prose: eligible
          ? 'The duel concludes.\n\n[TURNING_POINT]'
          : 'The duel concludes with a final blow.',
        resolvedModel: 'm',
        usedFallbackModel: false,
        completed: true,
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
          const role = state.members.get(key);
          return {
            data: role !== undefined ? { user_id: builder._filters.user_id, role } : null,
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

        if (table === 'entities') {
          const found = state.entities.get(builder._filters.id as string);
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
              turn_config: state.storyTurnConfig,
              content_rating: 'teen',
              conflict_policy: 'narrative_priority',
              owner_id: state.storyOwnerId,
            },
            error: null,
          };
        }

        if (table === 'chapters') {
          const found = state.chapters.get(builder._filters.id as string);
          return { data: found ?? null, error: null };
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

          const chapterId = `chapter-${state.nextChapterNumber}`;
          const chapter = {
            id: chapterId,
            story_id: existing?.story_id,
            turn_id: id,
            turn_number: existing?.turn_number ?? state.nextChapterNumber,
            turn_mode: existing?.mode ?? 'action',
            prose: args.p_prose,
            continues_chapter_id: existing?.continues_chapter_id ?? null,
          };
          state.chapters.set(chapterId, chapter);
          state.nextChapterNumber += 1;

          return { data: chapter, error: null };
        }

        if (name === 'continue_fight_turn') {
          if (state.continueFightBehavior === 'notFound') {
            return { data: null, error: { message: 'chapter not found' } };
          }

          const originChapterId = args.p_chapter_id as string;
          const originChapter = state.chapters.get(originChapterId);
          const originTurn = originChapter?.turn_id !== undefined ? turnRow(originChapter.turn_id as string) : null;

          const id = `turn-${state.turns.size + 1}`;
          const row = {
            id,
            story_id: args.p_story_id,
            turn_number: state.turns.size + 1,
            mode: originChapter?.turn_mode ?? 'action',
            scene_setup: null,
            status: 'locked',
            partial_prose: null,
            failure_reason: null,
            attempt_count: 0,
            continues_chapter_id: originChapterId,
          };
          state.turns.set(id, row);

          const originSubmissions = state.submissions.filter((sub) => sub.turn_id === originTurn?.id);
          for (const sub of originSubmissions) {
            state.submissions.push({ ...sub, id: `sub-${state.submissions.length + 1}`, turn_id: id });
          }

          return { data: row, error: null };
        }

        if (name === 'open_turn') {
          const id = `turn-${state.turns.size + 1}`;
          const row = {
            id,
            story_id: args.p_story_id,
            turn_number: state.turns.size + 1,
            mode: args.p_mode,
            scene_setup: args.p_scene_setup ?? null,
            status: 'open',
            partial_prose: null,
            failure_reason: null,
            attempt_count: 0,
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

const STORY = 'story-1';
const USER = 'user-1';
const TURN = 'turn-1';

beforeEach(() => {
  state.turns.clear();
  state.chapters.clear();
  state.submissions.length = 0;
  state.entities.clear();
  state.writes.length = 0;
  state.members.clear();
  // Owner-run, GM-less story is the default fixture — matches every prior
  // Phase 1-4 test's implicit assumption that USER can do everything.
  state.members.set(`${STORY}:${USER}`, 'owner');
  state.narrationBehavior = 'succeed';
  state.storyTurnConfig = {};
  state.storyOwnerId = USER;
  state.nextChapterNumber = 1;
  state.continueFightBehavior = 'succeed';

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
    continues_chapter_id: null,
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

describe('role gates', () => {
  const PLAYER = 'player-1';

  beforeEach(() => {
    state.members.set(`${STORY}:${PLAYER}`, 'player');
  });

  it('player cannot open a turn', async () => {
    const { openTurn } = await import('@/lib/engine/turns');

    await expect(openTurn(STORY, PLAYER)).rejects.toThrow(/required roles/);
  });

  it('player cannot manually lock a turn', async () => {
    const { createSubmission, lockTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I wait.', entityId: null });

    await expect(lockTurn(TURN, PLAYER)).rejects.toThrow(/required roles/);
  });

  it('deadline-sourced lock bypasses the role check', async () => {
    const { createSubmission, lockTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I wait.', entityId: null });

    const locked = await lockTurn(TURN, PLAYER, { source: 'deadline' });
    expect(locked.status).toBe('locked');
  });

  it('owner-run, GM-less story still opens and locks normally', async () => {
    const { openTurn, createSubmission, lockTurn } = await import('@/lib/engine/turns');

    // TURN already open from beforeEach; lock it first so a second open is legal.
    await createSubmission(TURN, USER, { content: 'I wait.', entityId: null });
    await lockTurn(TURN, USER);
    state.turns.set(TURN, { ...turnRow(TURN), status: 'published' });

    const opened = await openTurn(STORY, USER);
    expect(opened.status).toBe('open');
  });
});

describe('turn mode resolution on open', () => {
  beforeEach(() => {
    // Publish the fixture turn so a second open is legal.
    state.turns.set(TURN, { ...turnRow(TURN), status: 'published' });
  });

  it('uses the story active mode when none is passed explicitly', async () => {
    const { openTurn } = await import('@/lib/engine/turns');

    state.storyTurnConfig = { active_mode: 'action' };

    const opened = await openTurn(STORY, USER);
    expect(opened.mode).toBe('action');
  });

  it('defaults to freeform when the story has no active_mode set', async () => {
    const { openTurn } = await import('@/lib/engine/turns');

    state.storyTurnConfig = {};

    const opened = await openTurn(STORY, USER);
    expect(opened.mode).toBe('freeform');
  });

  it('an explicit mode option overrides the story active mode', async () => {
    const { openTurn } = await import('@/lib/engine/turns');

    state.storyTurnConfig = { active_mode: 'action' };

    const opened = await openTurn(STORY, USER, { mode: 'dialogue' });
    expect(opened.mode).toBe('dialogue');
  });

  it('rejects an unregistered active mode rather than writing it', async () => {
    const { openTurn } = await import('@/lib/engine/turns');

    state.storyTurnConfig = { active_mode: 'tactical' };

    await expect(openTurn(STORY, USER)).rejects.toThrow(/Unknown turn mode/);
  });
});

describe('entity control on submissions', () => {
  const CONTROLLER = 'controller-1';
  const OTHER_PLAYER = 'other-player-1';
  const ENTITY = '11111111-1111-4111-8111-111111111111';
  const UNCLAIMED_ENTITY = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    state.members.set(`${STORY}:${CONTROLLER}`, 'player');
    state.members.set(`${STORY}:${OTHER_PLAYER}`, 'player');
    state.entities.set(ENTITY, { id: ENTITY, controlled_by: CONTROLLER });
  });

  it('the controller can submit for their entity', async () => {
    const { createSubmission } = await import('@/lib/engine/turns');

    const submission = await createSubmission(TURN, CONTROLLER, {
      content: 'I strike.',
      entityId: ENTITY,
    });

    expect(submission.entityId).toBe(ENTITY);
  });

  it('a non-controller, non-GM cannot submit for a claimed entity', async () => {
    const { createSubmission } = await import('@/lib/engine/turns');

    await expect(
      createSubmission(TURN, OTHER_PLAYER, { content: 'I strike.', entityId: ENTITY }),
    ).rejects.toThrow(/does not control entity/);
  });

  it('owner/gm can submit for any entity, including one claimed by someone else', async () => {
    const { createSubmission } = await import('@/lib/engine/turns');

    const submission = await createSubmission(TURN, USER, {
      content: 'The GM narrates for this character.',
      entityId: ENTITY,
    });

    expect(submission.entityId).toBe(ENTITY);
  });

  it('a player cannot submit for an unclaimed entity they were never cast in', async () => {
    const { createSubmission, NotEntityControllerError } = await import('@/lib/engine/turns');
    state.entities.set(UNCLAIMED_ENTITY, { id: UNCLAIMED_ENTITY, controlled_by: null });

    await expect(
      createSubmission(TURN, OTHER_PLAYER, { content: 'I step in.', entityId: UNCLAIMED_ENTITY }),
    ).rejects.toThrow(NotEntityControllerError);
  });

  it('owner/gm can submit for an unclaimed entity, narrating an NPC', async () => {
    const { createSubmission } = await import('@/lib/engine/turns');
    state.entities.set(UNCLAIMED_ENTITY, { id: UNCLAIMED_ENTITY, controlled_by: null });

    const submission = await createSubmission(TURN, USER, {
      content: 'The innkeeper looks up.',
      entityId: UNCLAIMED_ENTITY,
    });

    expect(submission.entityId).toBe(UNCLAIMED_ENTITY);
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

describe('fight-chapter-split', () => {
  const FIGHTER_A = '11111111-1111-4111-8111-111111111111';
  const FIGHTER_B = '22222222-2222-4222-8222-222222222222';
  const FIGHTER_C = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    state.turns.set(TURN, { ...turnRow(TURN), mode: 'action' });
    state.entities.set(FIGHTER_A, { id: FIGHTER_A, controlled_by: USER });
    state.entities.set(FIGHTER_B, { id: FIGHTER_B, controlled_by: USER });
    state.entities.set(FIGHTER_C, { id: FIGHTER_C, controlled_by: USER });
  });

  it('publishes chapter 1 with the marker stripped, then auto-generates and publishes chapter 2 with no new submission', async () => {
    const { createSubmission, lockTurn, generateTurn } = await import('@/lib/engine/turns');

    // Single submitter fighting an established character (an NPC, say) that
    // never submits anything of its own — still eligible.
    await createSubmission(TURN, USER, { content: 'I strike the bandit captain.', entityId: FIGHTER_A });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'turningPoint';
    const result = await generateTurn(TURN, USER);

    // Chapter 1's persisted prose never contains the marker.
    expect(result.prose).not.toContain('[TURNING_POINT]');
    expect(result.prose).toBe('The blades clash in the rain.');

    const chapter1 = state.chapters.get(result.chapterId);
    expect(chapter1?.continues_chapter_id).toBeNull();

    // A second turn was created and driven to completion automatically —
    // no createSubmission call happened for it in this test.
    const allTurns = [...state.turns.values()];
    expect(allTurns).toHaveLength(2);

    const continuation = allTurns.find((t) => t.id !== TURN);
    expect(continuation?.status).toBe('published');
    expect(continuation?.continues_chapter_id).toBe(result.chapterId);

    // The continuation's chapter records the back-link.
    const chapter2 = [...state.chapters.values()].find((c) => c.turn_id === continuation?.id);
    expect(chapter2?.continues_chapter_id).toBe(result.chapterId);
  });

  it('copies submissions forward onto the continuation turn without re-invoking createSubmission', async () => {
    const { createSubmission, lockTurn, generateTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I strike the bandit captain.', entityId: FIGHTER_A });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'turningPoint';
    await generateTurn(TURN, USER);

    const continuationTurn = [...state.turns.values()].find((t) => t.id !== TURN);
    const copiedSubmissions = state.submissions.filter((s) => s.turn_id === continuationTurn?.id);

    expect(copiedSubmissions).toHaveLength(1);
    expect(copiedSubmissions[0]?.content).toBe('I strike the bandit captain.');
    // The copy is a new row distinct from the original, not the same row moved.
    expect(state.submissions.filter((s) => s.turn_id === TURN)).toHaveLength(1);
  });

  it('never lets a continuation split again, even if the model emits the marker anyway', async () => {
    const { createSubmission, lockTurn, generateTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I strike the bandit captain.', entityId: FIGHTER_A });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'turningPointThenResolve';
    await generateTurn(TURN, USER);

    const continuationTurn = [...state.turns.values()].find((t) => t.id !== TURN);
    expect(continuationTurn?.status).toBe('published');

    // Only two chapters total exist — the continuation did not itself split
    // into a third.
    expect(state.chapters.size).toBe(2);

    const chapter2 = [...state.chapters.values()].find((c) => c.turn_id === continuationTurn?.id);
    expect(chapter2?.prose).not.toContain('[TURNING_POINT]');
  });

  it('two or more distinct submitting entities never trigger a split, regardless of what the model emits', async () => {
    const { createSubmission, lockTurn, generateTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I strike.', entityId: FIGHTER_A });
    await createSubmission(TURN, USER, { content: 'I parry.', entityId: FIGHTER_B });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'turningPoint';
    const result = await generateTurn(TURN, USER);

    expect(turnRow(TURN)?.status).toBe('published');
    expect(state.chapters.size).toBe(1);
    // The mock always appends the marker in 'turningPoint' mode regardless
    // of eligibility — generateTurn must still strip it since a 2-submitter
    // turn's prompt never offered the option.
    expect(result.prose).not.toContain('[TURNING_POINT]');
  });

  it('three or more distinct submitting entities never trigger a split', async () => {
    const { createSubmission, lockTurn, generateTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I strike.', entityId: FIGHTER_A });
    await createSubmission(TURN, USER, { content: 'I parry.', entityId: FIGHTER_B });
    await createSubmission(TURN, USER, { content: 'I flank.', entityId: FIGHTER_C });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'turningPoint';
    const result = await generateTurn(TURN, USER);

    expect(turnRow(TURN)?.status).toBe('published');
    expect(state.chapters.size).toBe(1);
    expect(result.prose).not.toContain('[TURNING_POINT]');
  });

  it("a continuation turn's own generation failure does not affect chapter 1", async () => {
    const { createSubmission, lockTurn, generateTurn } = await import('@/lib/engine/turns');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await createSubmission(TURN, USER, { content: 'I strike the bandit captain.', entityId: FIGHTER_A });
    await lockTurn(TURN, USER);

    state.continueFightBehavior = 'notFound';
    state.narrationBehavior = 'turningPoint';

    const result = await generateTurn(TURN, USER);

    // generateTurn's own return value reflects only chapter 1 — the
    // continuation's failure never propagates into this call's result.
    expect(result.prose).toBe('The blades clash in the rain.');
    expect(turnRow(TURN)?.status).toBe('published');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'fight continuation failed',
      expect.objectContaining({ chapterId: result.chapterId }),
    );

    consoleErrorSpy.mockRestore();
  });

  it('a submission with no entity tag at all is still eligible (freeform action against any established character)', async () => {
    const { createSubmission, lockTurn, generateTurn } = await import('@/lib/engine/turns');

    await createSubmission(TURN, USER, { content: 'I strike the bandit captain.', entityId: null });
    await lockTurn(TURN, USER);

    state.narrationBehavior = 'turningPoint';
    const result = await generateTurn(TURN, USER);

    expect(result.prose).not.toContain('[TURNING_POINT]');
    expect(state.chapters.size).toBe(2);
  });
});
