import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Invite creation/revocation against a fake story_invites/story_members
 * table, and join behavior against a fake join_story_via_invite RPC —
 * exercised at the TS boundary since the RPC itself is verified live via
 * `supabase db advisors`/manual testing, not unit-testable without Postgres.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, { role: string }>(),
  invites: new Map<string, Record<string, unknown>>(),
  nextId: 1,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      _updatePayload: undefined as Record<string, unknown> | undefined,
      _insertPayload: undefined as Record<string, unknown> | undefined,
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        builder._filters[column] = value;
        return builder;
      },
      insert(payload: Record<string, unknown>) {
        builder._insertPayload = payload;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        builder._updatePayload = payload;
        return builder;
      },
      async single() {
        if (table === 'story_invites' && builder._insertPayload !== undefined) {
          const id = `invite-${state.nextId++}`;
          const row = { id, use_count: 0, revoked_at: null, ...builder._insertPayload };
          state.invites.set(id, row);
          return { data: row, error: null };
        }

        return { data: null, error: null };
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const key = `${builder._filters.story_id}:${builder._filters.user_id}`;
          const row = state.members.get(key);
          return { data: row ? { role: row.role } : null, error: null };
        }

        if (table === 'story_invites') {
          const row = state.invites.get(builder._filters.id as string);
          return { data: row ?? null, error: null };
        }

        return { data: null, error: null };
      },
      then(resolve: (result: { error: null }) => void) {
        if (table === 'story_invites' && builder._updatePayload !== undefined) {
          const id = builder._filters.id as string;
          const existing = state.invites.get(id);

          if (existing !== undefined) {
            state.invites.set(id, { ...existing, ...builder._updatePayload });
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
    createClient: async () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name !== 'join_story_via_invite') {
          return { data: null, error: { message: 'unknown rpc' } };
        }

        const invite = [...state.invites.values()].find((row) => row.token === args.p_token);

        if (invite === undefined) {
          return { data: null, error: { message: 'invite_not_found' } };
        }

        if (invite.revoked_at !== null) {
          return { data: null, error: { message: 'invite_revoked' } };
        }

        if (new Date(invite.expires_at as string).getTime() < Date.now()) {
          return { data: null, error: { message: 'invite_expired' } };
        }

        if (invite.max_uses !== null && (invite.use_count as number) >= (invite.max_uses as number)) {
          return { data: null, error: { message: 'invite_exhausted' } };
        }

        // Fake current user for the join — real callers resolve this from the
        // session; the test harness simulates that via a fixed test user.
        const uid = 'joining-user';
        const key = `${invite.story_id}:${uid}`;

        if (!state.members.has(key)) {
          state.members.set(key, { role: invite.role as string });
          invite.use_count = (invite.use_count as number) + 1;
        }

        return { data: invite.role, error: null };
      },
      from(table: string) {
        let token: unknown;
        const builder = {
          select() {
            return builder;
          },
          eq(column: string, value: unknown) {
            if (column === 'token') {
              token = value;
            }
            return builder;
          },
          async maybeSingle() {
            if (table === 'story_invites') {
              const invite = [...state.invites.values()].find((row) => row.token === token);
              return { data: invite !== undefined ? { story_id: invite.story_id } : null, error: null };
            }
            return { data: null, error: null };
          },
        };
        return builder;
      },
    }),
  };
});

const { createInvite, revokeInvite, joinViaInvite, InvalidInviteError } = await import(
  '@/lib/engine/invites'
);
const { InsufficientRoleError } = await import('@/lib/engine/membership');

const STORY = 'story-1';

beforeEach(() => {
  state.members.clear();
  state.invites.clear();
  state.nextId = 1;
  state.members.set(`${STORY}:owner-1`, { role: 'owner' });
  state.members.set(`${STORY}:gm-1`, { role: 'gm' });
  state.members.set(`${STORY}:player-1`, { role: 'player' });
});

describe('createInvite', () => {
  it('owner creates a player invite', async () => {
    const invite = await createInvite(STORY, 'owner-1', { role: 'player', expiresInDays: 7, maxUses: null });
    expect(invite.role).toBe('player');
    expect(invite.revokedAt).toBeNull();
  });

  it('rejects a non-owner/gm caller', async () => {
    await expect(
      createInvite(STORY, 'player-1', { role: 'player', expiresInDays: 7, maxUses: null }),
    ).rejects.toThrow(InsufficientRoleError);
  });

  it('rejects role: owner at the schema level', async () => {
    await expect(
      // @ts-expect-error -- role: 'owner' is intentionally not in the schema's enum
      createInvite(STORY, 'owner-1', { role: 'owner', expiresInDays: 7, maxUses: null }),
    ).rejects.toThrow();
  });
});

describe('joinViaInvite', () => {
  it('joins successfully with a valid token', async () => {
    const invite = await createInvite(STORY, 'owner-1', { role: 'player', expiresInDays: 7, maxUses: null });
    const result = await joinViaInvite(invite.token);
    expect(result.role).toBe('player');
    expect(result.storyId).toBe(STORY);
    expect(state.members.get(`${STORY}:joining-user`)?.role).toBe('player');
  });

  it('is idempotent for an already-joined user', async () => {
    const invite = await createInvite(STORY, 'owner-1', { role: 'player', expiresInDays: 7, maxUses: null });
    await joinViaInvite(invite.token);
    await joinViaInvite(invite.token);
    expect(state.invites.get(invite.id)?.use_count).toBe(1);
  });

  it('rejects an expired token', async () => {
    const invite = await createInvite(STORY, 'owner-1', { role: 'player', expiresInDays: 7, maxUses: null });
    state.invites.set(invite.id, { ...state.invites.get(invite.id), expires_at: new Date(Date.now() - 1000).toISOString() });
    await expect(joinViaInvite(invite.token)).rejects.toThrow(InvalidInviteError);
  });

  it('rejects a revoked token', async () => {
    const invite = await createInvite(STORY, 'owner-1', { role: 'player', expiresInDays: 7, maxUses: null });
    await revokeInvite(invite.id, 'owner-1');
    await expect(joinViaInvite(invite.token)).rejects.toThrow(InvalidInviteError);
  });

  it('rejects an exhausted token', async () => {
    const invite = await createInvite(STORY, 'owner-1', { role: 'player', expiresInDays: 7, maxUses: 1 });
    await joinViaInvite(invite.token);
    state.members.delete(`${STORY}:joining-user`); // simulate a second, different joining user
    await expect(joinViaInvite(invite.token)).rejects.toThrow(InvalidInviteError);
  });
});

describe('revokeInvite', () => {
  it('revocation blocks future joins without affecting existing members', async () => {
    const invite = await createInvite(STORY, 'owner-1', { role: 'player', expiresInDays: 7, maxUses: null });
    await joinViaInvite(invite.token);
    await revokeInvite(invite.id, 'owner-1');

    expect(state.members.has(`${STORY}:joining-user`)).toBe(true);
    expect(state.invites.get(invite.id)?.revoked_at).not.toBeNull();
  });

  it('rejects a non-owner/gm caller', async () => {
    const invite = await createInvite(STORY, 'owner-1', { role: 'player', expiresInDays: 7, maxUses: null });
    await expect(revokeInvite(invite.id, 'player-1')).rejects.toThrow(InsufficientRoleError);
  });
});
