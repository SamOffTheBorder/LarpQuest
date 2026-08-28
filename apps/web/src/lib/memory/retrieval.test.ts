import { describe, expect, it, vi } from 'vitest';
import { allowAllBudget } from '@/lib/ai/budget.test-helpers';

/**
 * Top-K similarity retrieval against a fake database. The invariant under
 * test: ordering is by similarity, retrieval never crosses a story_id
 * boundary, and an empty story returns an empty result rather than erroring.
 */

const state = vi.hoisted(() => ({
  chapterMatches: [] as { turn_number: number; summary: string; similarity: number }[],
  arcMatches: [] as { from_chapter: number; to_chapter: number; summary: string; similarity: number }[],
  calledWithStoryId: [] as string[],
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

vi.mock('@/lib/ai/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/gateway')>('@/lib/ai/gateway');
  return {
    ...actual,
    embedText: async () => ({ embedding: [0.1, 0.2], resolvedModel: 'm', usedFallbackModel: false }),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    rpc: async (name: string, args: { p_story_id: string; p_match_count: number }) => {
      state.calledWithStoryId.push(args.p_story_id);

      if (name === 'match_chapter_summaries') {
        return { data: state.chapterMatches.slice(0, args.p_match_count), error: null };
      }

      if (name === 'match_arc_summaries') {
        return { data: state.arcMatches.slice(0, args.p_match_count), error: null };
      }

      return { data: [], error: null };
    },
  }),
}));

const { retrieveRelevantSummaries } = await import('@/lib/memory/retrieval');

function recorder() {
  return { record: async () => {} };
}

describe('retrieveRelevantSummaries', () => {
  it('ranks chapter and arc matches together by similarity, highest first', async () => {
    state.chapterMatches = [{ turn_number: 5, summary: 'chapter 5', similarity: 0.6 }];
    state.arcMatches = [{ from_chapter: 1, to_chapter: 12, summary: 'arc 1-12', similarity: 0.9 }];

    const result = await retrieveRelevantSummaries({
      storyId: 'story-1',
      queryText: 'what happened with the key',
      k: 5,
      modelConfig: null,
      usage: recorder(),
      budget: allowAllBudget,
    });

    expect(result.map((r) => r.summary)).toEqual(['arc 1-12', 'chapter 5']);
    expect(result[0]?.similarity).toBeGreaterThan(result[1]?.similarity ?? 0);
  });

  it('caps the combined result at k', async () => {
    state.chapterMatches = [
      { turn_number: 1, summary: 'a', similarity: 0.9 },
      { turn_number: 2, summary: 'b', similarity: 0.8 },
    ];
    state.arcMatches = [{ from_chapter: 1, to_chapter: 12, summary: 'c', similarity: 0.7 }];

    const result = await retrieveRelevantSummaries({
      storyId: 'story-1',
      queryText: 'x',
      k: 2,
      modelConfig: null,
      usage: recorder(),
      budget: allowAllBudget,
    });

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.summary)).toEqual(['a', 'b']);
  });

  it('a story with no chapters returns an empty result without erroring', async () => {
    state.chapterMatches = [];
    state.arcMatches = [];

    const result = await retrieveRelevantSummaries({
      storyId: 'story-empty',
      queryText: 'x',
      k: 5,
      modelConfig: null,
      usage: recorder(),
      budget: allowAllBudget,
    });

    expect(result).toEqual([]);
  });

  it('scopes every match query to the given story_id', async () => {
    state.chapterMatches = [{ turn_number: 1, summary: 'a', similarity: 0.9 }];
    state.arcMatches = [];
    state.calledWithStoryId.length = 0;

    await retrieveRelevantSummaries({
      storyId: 'story-42',
      queryText: 'x',
      k: 5,
      modelConfig: null,
      usage: recorder(),
      budget: allowAllBudget,
    });

    expect(state.calledWithStoryId.every((id) => id === 'story-42')).toBe(true);
  });

  it('returns immediately without a database call when k is 0', async () => {
    state.calledWithStoryId.length = 0;

    const result = await retrieveRelevantSummaries({
      storyId: 'story-1',
      queryText: 'x',
      k: 0,
      modelConfig: null,
      usage: recorder(),
      budget: allowAllBudget,
    });

    expect(result).toEqual([]);
    expect(state.calledWithStoryId).toHaveLength(0);
  });

  it('an arc match carries its chapter range, distinct from a single-chapter match', async () => {
    state.chapterMatches = [];
    state.arcMatches = [{ from_chapter: 50, to_chapter: 61, summary: 'arc summary', similarity: 0.8 }];

    const result = await retrieveRelevantSummaries({
      storyId: 'story-1',
      queryText: 'x',
      k: 5,
      modelConfig: null,
      usage: recorder(),
      budget: allowAllBudget,
    });

    expect(result[0]?.arcRange).toEqual({ fromChapter: 50, toChapter: 61 });
    expect(result[0]?.turnNumber).toBe(61);
  });
});
