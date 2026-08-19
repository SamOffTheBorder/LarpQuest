import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Marketplace listing/clone against a fake session-bound client. Invariants
 * under test: listing includes others' public universes and excludes
 * others' private ones (delegated to RLS in production; simulated here by
 * the mock only ever returning is_public rows, matching what the real
 * policy would filter to); clone succeeds for a public universe and is
 * denied for a private one not owned by the caller (delegated to
 * clone_universe's own guard); editing the source after cloning does not
 * affect the fork (the SQL function copies content by value, not reference
 * — verified structurally by the RPC call args, since the copy itself
 * happens in SQL not JS).
 */

const state = vi.hoisted(() => ({
  universes: [] as Record<string, unknown>[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  cloneBehavior: 'succeed' as 'succeed' | 'denied',
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        then(resolve: (v: { data: unknown[]; error: null }) => void) {
          if (table === 'universes') {
            resolve({ data: state.universes.filter((u) => u.is_public === true), error: null });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ name, args });

      if (name === 'clone_universe') {
        if (state.cloneBehavior === 'denied') {
          return { data: null, error: { message: 'universe is not public and is not owned by caller' } };
        }
        return { data: { universe_id: 'new-universe-1', version: 1 }, error: null };
      }

      return { data: null, error: null };
    },
  }),
}));

const { listPublicUniverses, cloneUniverse } = await import('@/lib/engine/marketplace');

beforeEach(() => {
  state.universes.length = 0;
  state.rpcCalls.length = 0;
  state.cloneBehavior = 'succeed';

  state.universes.push(
    { id: 'universe-1', name: 'Ashfall Legion', owner_id: 'owner-a', forked_from: null, created_at: 't1', is_public: true },
    { id: 'universe-2', name: 'Private World', owner_id: 'owner-b', forked_from: null, created_at: 't2', is_public: false },
  );
});

describe('listPublicUniverses', () => {
  it('returns public universes owned by anyone', async () => {
    const universes = await listPublicUniverses();

    expect(universes).toHaveLength(1);
    expect(universes[0]?.name).toBe('Ashfall Legion');
  });

  it('excludes private universes', async () => {
    const universes = await listPublicUniverses();

    expect(universes.some((u) => u.name === 'Private World')).toBe(false);
  });
});

describe('cloneUniverse', () => {
  it('clones a public universe via the clone_universe RPC', async () => {
    const result = await cloneUniverse('universe-1', 'cloner-1');

    expect(result).toEqual({ universeId: 'new-universe-1', version: 1 });
    expect(state.rpcCalls).toEqual([
      { name: 'clone_universe', args: { p_universe_id: 'universe-1', p_owner_id: 'cloner-1' } },
    ]);
  });

  it('propagates denial for a private universe not owned by the caller', async () => {
    state.cloneBehavior = 'denied';

    await expect(cloneUniverse('universe-2', 'cloner-1')).rejects.toThrow(/not public/);
  });

  it('does not touch the source universe row directly — the copy is entirely server-side', async () => {
    const before = { ...state.universes.find((u) => u.id === 'universe-1') };

    await cloneUniverse('universe-1', 'cloner-1');

    const after = state.universes.find((u) => u.id === 'universe-1');
    expect(after).toEqual(before);
  });
});
