import { describe, expect, it, vi } from 'vitest';

import { shouldCompactArc, ARC_COMPACTION_THRESHOLD_CHAPTERS, ARC_SIZE_CHAPTERS } from '@/lib/memory/arc-compaction';
import { allowAllBudget } from '@/lib/ai/budget.test-helpers';

/**
 * `shouldCompactArc` is a pure function of the chapter count — no database
 * read — so every boundary is directly assertable. `generateArcSummary` is
 * exercised separately below through a mocked gateway, verifying it reads
 * chapter summaries (not prose) and writes to the right chapter range.
 */

describe('shouldCompactArc', () => {
  it('is null below the compaction threshold', () => {
    expect(shouldCompactArc(1)).toBeNull();
    expect(shouldCompactArc(ARC_COMPACTION_THRESHOLD_CHAPTERS - 1)).toBeNull();
  });

  it('is null at the threshold itself, before a full arc has closed', () => {
    expect(shouldCompactArc(ARC_COMPACTION_THRESHOLD_CHAPTERS)).toBeNull();
  });

  it('returns the first arc range exactly when it closes', () => {
    const closingChapter = ARC_COMPACTION_THRESHOLD_CHAPTERS + ARC_SIZE_CHAPTERS - 1;

    expect(shouldCompactArc(closingChapter)).toEqual({
      fromChapter: ARC_COMPACTION_THRESHOLD_CHAPTERS,
      toChapter: closingChapter,
    });
  });

  it('is null for chapters between arc boundaries', () => {
    const closingChapter = ARC_COMPACTION_THRESHOLD_CHAPTERS + ARC_SIZE_CHAPTERS - 1;
    expect(shouldCompactArc(closingChapter - 1)).toBeNull();
    expect(shouldCompactArc(closingChapter + 1)).toBeNull();
  });

  it('returns the second arc range at the next boundary', () => {
    const firstClose = ARC_COMPACTION_THRESHOLD_CHAPTERS + ARC_SIZE_CHAPTERS - 1;
    const secondClose = firstClose + ARC_SIZE_CHAPTERS;

    expect(shouldCompactArc(secondClose)).toEqual({
      fromChapter: firstClose + 1,
      toChapter: secondClose,
    });
  });
});

const state = vi.hoisted(() => ({
  summarizerBehavior: 'succeed' as 'succeed' | 'throw',
  inserted: [] as Record<string, unknown>[],
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

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      return {
        insert: async (values: Record<string, unknown>) => {
          if (table === 'arc_summaries') {
            state.inserted.push(values);
          }
          return { error: null };
        },
      };
    },
  }),
}));

vi.mock('@/lib/ai/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/gateway')>('@/lib/ai/gateway');

  return {
    ...actual,
    callStructured: async (
      deps: { usage: { record: (entry: unknown) => Promise<void> } },
      args: { role: string; userPrompt: string },
    ) => {
      if (state.summarizerBehavior === 'throw') {
        await deps.usage.record({ role: args.role, succeeded: false });
        throw new Error('transport failure');
      }

      await deps.usage.record({ role: args.role, succeeded: true });
      // Echo the prompt so the test can assert it was built from summaries.
      return {
        data: { summary: `Arc summary from: ${args.userPrompt}` },
        resolvedModel: 'test/summarizer',
        usedFallbackModel: false,
      };
    },
    embedText: async () => ({ embedding: [0.4, 0.5], resolvedModel: 'test/embedder', usedFallbackModel: false }),
  };
});

const { generateArcSummary } = await import('@/lib/memory/arc-compaction');

function recorder() {
  return { record: async () => {} };
}

describe('generateArcSummary', () => {
  it('writes an arc_summaries row for the given chapter range, built from chapter summaries not prose', async () => {
    state.summarizerBehavior = 'succeed';
    state.inserted.length = 0;

    const outcome = await generateArcSummary({
      storyId: 'story-1',
      fromChapter: 50,
      toChapter: 61,
      chapterSummaries: [
        { turnNumber: 50, summary: 'Kestrel arrived at the harbor.' },
        { turnNumber: 51, summary: 'A storm delayed departure.' },
      ],
      modelConfig: null,
      retrievalBias: 'precedent',
      usage: recorder(),
      budget: allowAllBudget,
    });

    expect(outcome.status).toBe('complete');
    expect(state.inserted).toEqual([
      {
        story_id: 'story-1',
        from_chapter: 50,
        to_chapter: 61,
        summary: expect.stringContaining('Kestrel arrived at the harbor.') as unknown as string,
        embedding: '[0.4,0.5]',
      },
    ]);
  });

  it('returns a failed outcome without writing a row when the summarizer call fails', async () => {
    state.summarizerBehavior = 'throw';
    state.inserted.length = 0;

    const outcome = await generateArcSummary({
      storyId: 'story-1',
      fromChapter: 50,
      toChapter: 61,
      chapterSummaries: [{ turnNumber: 50, summary: 'x' }],
      modelConfig: null,
      retrievalBias: 'precedent',
      usage: recorder(),
      budget: allowAllBudget,
    });

    expect(outcome).toEqual({ status: 'failed', error: 'transport failure' });
    expect(state.inserted).toHaveLength(0);
  });
});
