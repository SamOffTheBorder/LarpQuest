import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Role-gated authorization against a fake story_members table. Covers the
 * gap Phase 5 closes: Phase 1-4 code checked membership only, never role —
 * these tests are the first to exercise requireRole/removeMember at all.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, { role: string }>(), // key: `${storyId}:${userId}`
  entities: new Map<string, { story_id: string; controlled_by: string | null }>(),
  leavingUser: 'player-1', // stands in for auth.uid() inside leave_story
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      _updatePayload: undefined as Record<string, unknown> | undefined,
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        builder._filters[column] = value;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        builder._updatePayload = payload;
        return builder;
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const key = `${builder._filters.story_id}:${builder._filters.user_id}`;
          const row = state.members.get(key);
          return { data: row ? { role: row.role } : null, error: null };
        }

        return { data: null, error: null };
      },
      then(resolve: (result: { error: null }) => void) {
        // Awaiting the builder directly (update/delete without a terminal
        // select) resolves here.
        if (table === 'entities' && builder._updatePayload !== undefined) {
          for (const [id, entity] of state.entities) {
            if (
              entity.story_id === builder._filters.story_id &&
              entity.controlled_by === builder._filters.controlled_by
            ) {
              state.entities.set(id, { ...entity, controlled_by: builder._updatePayload.controlled_by as string | null });
            }
          }
        }

        if (table === 'story_members' && builder._filters.story_id !== undefined && builder._updatePayload === undefined) {
          // delete()
          const key = `${builder._filters.story_id}:${builder._filters.user_id}`;
          state.members.delete(key);
        }

        resolve({ error: null });
        return Promise.resolve({ error: null });
      },
      delete() {
        return builder;
      },
    };

    return builder;
  }

  return {
    createServiceRoleClient: () => ({ from }),
    // leave_story runs under the caller's session, so it goes through
    // createClient rather than the service-role client. LEAVING_USER stands in
    // for auth.uid(), which the real function reads server-side.
    createClient: async () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name !== 'leave_story') {
          return { data: null, error: { message: 'unknown rpc' } };
        }

        const storyId = args.p_story_id as string;
        const key = `${storyId}:${state.leavingUser}`;
        const member = state.members.get(key);

        if (member === undefined) {
          return { data: null, error: { message: 'not_a_member' } };
        }

        if (member.role === 'owner') {
          return { data: null, error: { message: 'owner_cannot_leave' } };
        }

        for (const [id, entity] of state.entities) {
          if (entity.story_id === storyId && entity.controlled_by === state.leavingUser) {
            state.entities.set(id, { ...entity, controlled_by: null });
          }
        }

        state.members.delete(key);
        return { data: null, error: null };
      },
    }),
  };
});

const {
  requireRole,
  hasRole,
  isGM,
  removeMember,
  leaveStory,
  InsufficientRoleError,
  NotAMemberError,
  OwnerCannotLeaveError,
} = await import('@/lib/engine/membership');

const STORY = 'story-1';

beforeEach(() => {
  state.members.clear();
  state.entities.clear();
  state.leavingUser = 'player-1';
  state.members.set(`${STORY}:owner-1`, { role: 'owner' });
  state.members.set(`${STORY}:gm-1`, { role: 'gm' });
  state.members.set(`${STORY}:player-1`, { role: 'player' });
  state.members.set(`${STORY}:spectator-1`, { role: 'spectator' });
});

describe('leaveStory', () => {
  it('a player leaves under their own power and their characters are released', async () => {
    state.entities.set('entity-1', { story_id: STORY, controlled_by: 'player-1' });

    await leaveStory(STORY);

    expect(state.members.has(`${STORY}:player-1`)).toBe(false);
    expect(state.entities.get('entity-1')?.controlled_by).toBeNull();
  });

  it('leaves other members characters alone', async () => {
    state.entities.set('entity-1', { story_id: STORY, controlled_by: 'player-1' });
    state.entities.set('entity-2', { story_id: STORY, controlled_by: 'gm-1' });

    await leaveStory(STORY);

    expect(state.entities.get('entity-2')?.controlled_by).toBe('gm-1');
  });

  it('refuses the owner, who would strand the story with no manager', async () => {
    state.leavingUser = 'owner-1';

    await expect(leaveStory(STORY)).rejects.toThrow(OwnerCannotLeaveError);
    expect(state.members.has(`${STORY}:owner-1`)).toBe(true);
  });

  it('a GM may leave — only the owner is load-bearing', async () => {
    state.leavingUser = 'gm-1';

    await expect(leaveStory(STORY)).resolves.toBeUndefined();
    expect(state.members.has(`${STORY}:gm-1`)).toBe(false);
  });

  it('rejects someone who is not a member', async () => {
    state.leavingUser = 'stranger';

    await expect(leaveStory(STORY)).rejects.toThrow(NotAMemberError);
  });
});

describe('hasRole / isGM', () => {
  it('isGM is true only for gm', () => {
    expect(isGM('gm')).toBe(true);
    expect(isGM('owner')).toBe(false);
  });

  it('hasRole checks membership in the allowed list', () => {
    expect(hasRole('player', ['owner', 'gm'])).toBe(false);
    expect(hasRole('gm', ['owner', 'gm'])).toBe(true);
  });
});

describe('requireRole', () => {
  it('allows a user whose role is in the allowed set', async () => {
    await expect(requireRole(STORY, 'gm-1', ['owner', 'gm'])).resolves.toBeUndefined();
  });

  it('allows owner-run, GM-less stories', async () => {
    await expect(requireRole(STORY, 'owner-1', ['owner', 'gm'])).resolves.toBeUndefined();
  });

  it('rejects a player attempting an owner/gm-only action', async () => {
    await expect(requireRole(STORY, 'player-1', ['owner', 'gm'])).rejects.toThrow(InsufficientRoleError);
  });

  it('rejects a non-member the same way as an insufficient role', async () => {
    await expect(requireRole(STORY, 'stranger', ['owner', 'gm'])).rejects.toThrow(InsufficientRoleError);
  });
});

describe('removeMember', () => {
  it('gm removes a player and clears their controlled_by', async () => {
    state.entities.set('entity-1', { story_id: STORY, controlled_by: 'player-1' });

    await removeMember(STORY, 'gm-1', 'player-1');

    expect(state.members.has(`${STORY}:player-1`)).toBe(false);
    expect(state.entities.get('entity-1')?.controlled_by).toBeNull();
  });

  it('does not touch other members entities when one departs', async () => {
    state.entities.set('entity-1', { story_id: STORY, controlled_by: 'player-1' });
    state.entities.set('entity-2', { story_id: STORY, controlled_by: 'gm-1' });

    await removeMember(STORY, 'owner-1', 'player-1');

    expect(state.entities.get('entity-2')?.controlled_by).toBe('gm-1');
  });

  it('rejects a player removing another member', async () => {
    await expect(removeMember(STORY, 'player-1', 'spectator-1')).rejects.toThrow(InsufficientRoleError);
  });

  it('rejects removing the owner', async () => {
    await expect(removeMember(STORY, 'gm-1', 'owner-1')).rejects.toThrow('cannot be removed');
  });
});
