import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Entity claiming against a fake entities/story_members table. Covers the
 * gap where controlled_by existed in the schema but nothing enforced it.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, { role: string }>(),
  entities: new Map<string, { story_id: string; controlled_by: string | null }>(),
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

        if (table === 'entities') {
          const row = state.entities.get(builder._filters.id as string);
          return { data: row ?? null, error: null };
        }

        return { data: null, error: null };
      },
      then(resolve: (result: { error: null }) => void) {
        if (table === 'entities' && builder._updatePayload !== undefined) {
          const id = builder._filters.id as string;
          const existing = state.entities.get(id);

          if (existing !== undefined) {
            state.entities.set(id, { ...existing, controlled_by: builder._updatePayload.controlled_by as string | null });
          }
        }

        resolve({ error: null });
        return Promise.resolve({ error: null });
      },
    };

    return builder;
  }

  return {
    createServiceRoleClient: () => ({ from }),
  };
});

const {
  claimEntity,
  releaseEntity,
  reassignEntity,
  EntityAlreadyControlledError,
} = await import('@/lib/engine/entity-claims');
const { InsufficientRoleError } = await import('@/lib/engine/membership');

const STORY = 'story-1';

beforeEach(() => {
  state.members.clear();
  state.entities.clear();
  state.members.set(`${STORY}:owner-1`, { role: 'owner' });
  state.members.set(`${STORY}:gm-1`, { role: 'gm' });
  state.members.set(`${STORY}:player-1`, { role: 'player' });
  state.members.set(`${STORY}:player-2`, { role: 'player' });
  state.entities.set('entity-1', { story_id: STORY, controlled_by: null });
});

describe('claimEntity', () => {
  it('claims an unclaimed entity', async () => {
    await claimEntity('entity-1', 'player-1');
    expect(state.entities.get('entity-1')?.controlled_by).toBe('player-1');
  });

  it('rejects claiming an entity already controlled by another user', async () => {
    await claimEntity('entity-1', 'player-1');
    await expect(claimEntity('entity-1', 'player-2')).rejects.toThrow(EntityAlreadyControlledError);
  });

  it('re-claiming your own already-controlled entity is a no-op success', async () => {
    await claimEntity('entity-1', 'player-1');
    await expect(claimEntity('entity-1', 'player-1')).resolves.toBeUndefined();
  });
});

describe('releaseEntity', () => {
  it('the controller releases their own claim', async () => {
    await claimEntity('entity-1', 'player-1');
    await releaseEntity('entity-1', 'player-1');
    expect(state.entities.get('entity-1')?.controlled_by).toBeNull();
  });

  it('a non-controller, non-GM cannot release', async () => {
    await claimEntity('entity-1', 'player-1');
    await expect(releaseEntity('entity-1', 'player-2')).rejects.toThrow(InsufficientRoleError);
  });

  it('a GM can release someone else\'s claim', async () => {
    await claimEntity('entity-1', 'player-1');
    await expect(releaseEntity('entity-1', 'gm-1')).resolves.toBeUndefined();
  });
});

describe('reassignEntity', () => {
  it('gm reassigns an already-controlled entity, overriding the existing controller', async () => {
    await claimEntity('entity-1', 'player-1');
    await reassignEntity('entity-1', 'gm-1', 'player-2');
    expect(state.entities.get('entity-1')?.controlled_by).toBe('player-2');
  });

  it('a player cannot reassign', async () => {
    await expect(reassignEntity('entity-1', 'player-1', 'player-2')).rejects.toThrow(InsufficientRoleError);
  });
});
