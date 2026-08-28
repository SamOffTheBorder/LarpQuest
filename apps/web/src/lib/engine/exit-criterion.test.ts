import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end proof of Phase 5's exit criterion (build plan Part 10): "Five
 * people run a story together across a week without coordination outside
 * the app."
 *
 * Follows Phase 3/4's exit-criterion pattern: drive the real exported
 * functions against a mocked gateway/database rather than re-deriving
 * behavior already covered unit-by-unit elsewhere. This test's job is to
 * prove the *coordination mechanism* holds together across a realistic
 * multi-person sequence — invite, join, claim, role-gated submission, a
 * deadline passing on an absent player, moderation — not to re-exercise
 * full chapter generation (turns.test.ts already covers that path).
 *
 * "Across a week" (real elapsed time / a real external scheduler polling
 * /api/worker/deadlines) is not reproducible in this environment, same
 * caveat Phase 3 used for real research-pipeline timing — this test proves
 * the mechanism reaches the right state when the sweep runs, not that a
 * week actually elapses.
 */

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/api-key', () => ({
  resolveStoryApiKey: async () => ({ key: 'test-key', source: 'platform' }),
  resolvePlatformApiKey: () => ({ key: 'test-key', source: 'platform' }),
}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }),
  clientEnv: {},
}));

class FakeStructuredOutputError extends Error {}

vi.mock('@/lib/ai/gateway', () => ({
  StructuredOutputError: FakeStructuredOutputError,
  callStructured: async () => ({
    data: { verdict: 'pass', reason: 'Nothing concerning.' },
    resolvedModel: 'test/moderator',
    usedFallbackModel: false,
  }),
}));

vi.mock('@/lib/ai/usage', () => ({
  createUsageRecorder: () => ({ record: async () => {} }),
}));

vi.mock('@/lib/memory/retrieval', () => ({
  retrieveRelevantSummaries: async () => [],
}));

const state = vi.hoisted(() => ({
  members: new Map<string, { role: string }>(), // `${storyId}:${userId}`
  stories: new Map<string, Record<string, unknown>>(),
  entities: new Map<string, Record<string, unknown>>(),
  turns: new Map<string, Record<string, unknown>>(),
  submissions: [] as Record<string, unknown>[],
  invites: new Map<string, Record<string, unknown>>(),
}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      _notFilters: {} as Record<string, unknown>,
      _ltFilters: {} as Record<string, unknown>,
      _updatePayload: undefined as Record<string, unknown> | undefined,
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
      update(payload: Record<string, unknown>) {
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
            if (table === 'turns') {
              const id = updateBuilder._eq.id as string;
              const existing = state.turns.get(id);
              if (existing === undefined) return { data: null, error: null };
              if (updateBuilder._eq.status !== undefined && existing.status !== updateBuilder._eq.status) {
                return { data: null, error: null };
              }
              const next = { ...existing, ...payload };
              state.turns.set(id, next);
              return { data: next, error: null };
            }
            return { data: null, error: null };
          },
          then(resolve: (r: { error: null }) => void) {
            if (table === 'entities') {
              for (const [id, entity] of state.entities) {
                if (
                  ('story_id' in updateBuilder._eq ? entity.story_id === updateBuilder._eq.story_id : true) &&
                  ('controlled_by' in updateBuilder._eq ? entity.controlled_by === updateBuilder._eq.controlled_by : true) &&
                  ('id' in updateBuilder._eq ? id === updateBuilder._eq.id : true)
                ) {
                  state.entities.set(id, { ...entity, ...payload });
                }
              }
            }
            resolve({ error: null });
          },
        };
        return updateBuilder;
      },
      insert(payload: Record<string, unknown>) {
        if (table === 'submissions') {
          const row = { id: `sub-${state.submissions.length + 1}`, ...payload };
          state.submissions.push(row);
          return {
            select() {
              return {
                async single() {
                  return { data: row, error: null };
                },
              };
            },
            // deadlines.ts awaits the insert directly, with no .select() chain.
            then(resolve: (r: { error: null }) => void) {
              resolve({ error: null });
            },
          };
        }

        if (table === 'story_invites') {
          const row = {
            id: `invite-${state.invites.size + 1}`,
            use_count: 0,
            revoked_at: null,
            ...payload,
          };
          state.invites.set(row.id, row);
          return {
            select() {
              return {
                async single() {
                  return { data: row, error: null };
                },
              };
            },
          };
        }

        return Promise.resolve({ error: null });
      },
      async single() {
        if (table === 'stories') {
          const row = state.stories.get(builder._filters.id as string);
          return { data: row ?? null, error: null };
        }
        if (table === 'story_members') {
          for (const [key, value] of state.members) {
            const [sid] = key.split(':');
            if (sid === builder._filters.story_id && value.role === 'owner') {
              return { data: { user_id: key.split(':')[1] }, error: null };
            }
          }
          return { data: null, error: { message: 'no owner' } };
        }
        return { data: null, error: null };
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const key = `${builder._filters.story_id}:${builder._filters.user_id}`;
          const role = state.members.get(key);
          return { data: role !== undefined ? { role: role.role } : null, error: null };
        }
        if (table === 'entities') {
          return { data: state.entities.get(builder._filters.id as string) ?? null, error: null };
        }
        if (table === 'turns') {
          return { data: state.turns.get(builder._filters.id as string) ?? null, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve: (r: { data: unknown[]; error: null; count?: number }) => void) {
        if (table === 'submissions') {
          const rows = state.submissions.filter((row) => row.turn_id === builder._filters.turn_id);
          resolve({ data: rows, error: null, count: rows.length });
          return;
        }
        if (table === 'entities') {
          const rows = [...state.entities.values()].filter((entity) => {
            if (builder._filters.story_id !== undefined && entity.story_id !== builder._filters.story_id) return false;
            if ('controlled_by' in builder._notFilters && entity.controlled_by === null) return false;
            return true;
          });
          resolve({ data: rows, error: null });
          return;
        }
        if (table === 'turns') {
          const rows = [...state.turns.values()].filter((turn) => {
            if (builder._filters.status !== undefined && turn.status !== builder._filters.status) return false;
            if ('deadline' in builder._notFilters && turn.deadline === null) return false;
            if ('deadline' in builder._ltFilters) {
              const deadline = turn.deadline as string | null;
              if (deadline === null || deadline >= (builder._ltFilters.deadline as string)) return false;
            }
            return true;
          });
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
            scene_setup: args.p_scene_setup ?? null,
            status: 'open',
            partial_prose: null,
            failure_reason: null,
            attempt_count: 0,
            deadline: null,
          };
          state.turns.set(id, row);
          return { data: row, error: null };
        }
        return { data: null, error: null };
      },
    }),
    createClient: async () => ({
      rpc: async (_name: string, args: { p_token: string }) => {
        const invite = [...state.invites.values()].find((row) => row.token === args.p_token);
        if (invite === undefined) return { data: null, error: { message: 'invite_not_found' } };
        // Fixed joining identity for this test — mirrors invites.test.ts's approach.
        const uid = 'player-2';
        const key = `${invite.story_id}:${uid}`;
        if (!state.members.has(key)) {
          state.members.set(key, { role: invite.role as string });
        }
        return { data: [{ role: invite.role, story_id: invite.story_id }], error: null };
      },
    }),
  };
});

const { createInvite, joinViaInvite } = await import('@/lib/engine/invites');
const { assignEntity } = await import('@/lib/engine/entity-claims');
const { createSubmission, openTurn } = await import('@/lib/engine/turns');
const { sweepDeadlines } = await import('@/lib/engine/deadlines');

const STORY = 'story-1';
const OWNER = 'owner-1';
const PLAYER_2 = 'player-2'; // joins via invite
const ENTITY_1 = '11111111-1111-4111-8111-111111111111'; // owner's character, submits in time
const ENTITY_2 = '22222222-2222-4222-8222-222222222222'; // player-2's character, goes absent

beforeEach(() => {
  state.members.clear();
  state.stories.clear();
  state.entities.clear();
  state.turns.clear();
  state.submissions.length = 0;
  state.invites.clear();

  state.members.set(`${STORY}:${OWNER}`, { role: 'owner' });
  state.stories.set(STORY, {
    turn_config: { absent_policy: 'ai_plays' },
    content_rating: 'teen',
    conflict_policy: 'narrative_priority',
    model_config: null,
  });
  state.entities.set(ENTITY_1, { id: ENTITY_1, story_id: STORY, name: 'Aria', controlled_by: OWNER });
});

describe('Phase 5 exit criterion: five people coordinate through the app, not outside it', () => {
  it('a second player joins by invite, is cast in a character, and only they may act for it', async () => {
    const invite = await createInvite(STORY, OWNER, { role: 'player', expiresInDays: 7, maxUses: null });
    const result = await joinViaInvite(invite.token);

    expect(result.role).toBe('player');
    expect(state.members.get(`${STORY}:${PLAYER_2}`)?.role).toBe('player');

    state.entities.set(ENTITY_2, { id: ENTITY_2, story_id: STORY, name: 'Bram', controlled_by: null });
    // The owner casts the new player — control is granted by a GM, not taken.
    await assignEntity(ENTITY_2, OWNER, PLAYER_2);
    expect(state.entities.get(ENTITY_2)?.controlled_by).toBe(PLAYER_2);

    // A different, uninvolved member cannot act for the newly assigned entity.
    state.members.set(`${STORY}:intruder`, { role: 'player' });
    state.turns.set('turn-1', {
      id: 'turn-1',
      story_id: STORY,
      status: 'open',
      deadline: null,
    });

    await expect(
      createSubmission('turn-1', 'intruder', { content: 'I act for Bram.', entityId: ENTITY_2 }),
    ).rejects.toThrow(/does not control entity/);
  });

  it('a turn locks on schedule even though one player never shows up, and the story keeps moving', async () => {
    await joinViaInvite((await createInvite(STORY, OWNER, { role: 'player', expiresInDays: 7, maxUses: null })).token);
    state.entities.set(ENTITY_2, { id: ENTITY_2, story_id: STORY, name: 'Bram', controlled_by: PLAYER_2 });

    const turn = await openTurn(STORY, OWNER, { mode: 'freeform' });
    state.turns.set(turn.id, { ...state.turns.get(turn.id), deadline: new Date(Date.now() - 1000).toISOString() });

    // Only the present player (owner's entity) submits before the deadline.
    await createSubmission(turn.id, OWNER, { content: 'I press forward.', entityId: ENTITY_1 });

    const outcome = await sweepDeadlines();

    expect(outcome.locked).toBe(1);
    expect(state.turns.get(turn.id)?.status).toBe('locked');
    // The absent player's character got a placeholder, not silence, and not
    // a block on the whole story.
    expect(state.submissions).toHaveLength(2);
    const placeholder = state.submissions.find((s) => s.entity_id === ENTITY_2);
    expect(placeholder?.content).toContain('Bram waits');
    expect(placeholder?.user_id).toBe(PLAYER_2);

    // Moderation ran as part of the lock and passed cleanly.
    expect(state.turns.get(turn.id)?.moderation_status).toBe('pass');
  });

  it('a player cannot skip the coordination the app enforces by opening a turn themselves', async () => {
    await joinViaInvite((await createInvite(STORY, OWNER, { role: 'player', expiresInDays: 7, maxUses: null })).token);

    await expect(openTurn(STORY, PLAYER_2, { mode: 'freeform' })).rejects.toThrow(/required roles/);
  });
});
