import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * search.ts is a thin wrapper around the search_story RPC, which enforces
 * membership itself via auth.uid(). The invariant under test here is the
 * client choice (session-bound, not service-role — matching invites.ts's
 * joinViaInvite) and the response mapping, since the membership/ranking
 * logic itself lives in SQL and is not re-tested at this layer.
 */

const state = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  behavior: 'succeed' as 'succeed' | 'denied' | 'empty',
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    async rpc(name: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ name, args });

      if (state.behavior === 'denied') {
        return { data: null, error: { message: 'not a member of story story-1' } };
      }

      if (state.behavior === 'empty') {
        return { data: [], error: null };
      }

      return {
        data: [
          { kind: 'chapter', id: 'chapter-1', title: 'Chapter 3', snippet: 'the harbor...', rank: 0.9 },
          { kind: 'entity', id: 'entity-1', title: 'Kestrel', snippet: 'a wary courier', rank: 0.4 },
        ],
        error: null,
      };
    },
  }),
}));

const { searchStory } = await import('@/lib/engine/search');

beforeEach(() => {
  state.rpcCalls.length = 0;
  state.behavior = 'succeed';
});

describe('searchStory', () => {
  it('calls the search_story RPC under the caller session, not service-role', async () => {
    await searchStory('story-1', 'harbor');

    expect(state.rpcCalls).toEqual([{ name: 'search_story', args: { p_story_id: 'story-1', p_query: 'harbor' } }]);
  });

  it('maps chapter and entity results with their kind discriminator intact', async () => {
    const results = await searchStory('story-1', 'harbor');

    expect(results).toEqual([
      { kind: 'chapter', id: 'chapter-1', title: 'Chapter 3', snippet: 'the harbor...', rank: 0.9 },
      { kind: 'entity', id: 'entity-1', title: 'Kestrel', snippet: 'a wary courier', rank: 0.4 },
    ]);
  });

  it('returns an empty array rather than throwing when nothing matches', async () => {
    state.behavior = 'empty';

    const results = await searchStory('story-1', 'no matches for this');

    expect(results).toEqual([]);
  });

  it('throws when the RPC denies the caller (non-member)', async () => {
    state.behavior = 'denied';

    await expect(searchStory('story-1', 'harbor')).rejects.toThrow(/not a member/);
  });
});
