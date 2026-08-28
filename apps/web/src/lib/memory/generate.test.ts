import { describe, expect, it, vi } from 'vitest';
import { allowAllBudget } from '@/lib/ai/budget.test-helpers';

/**
 * The invariant under test: `generateChapterMemory` never throws — a failure
 * in either the summarizer call or the embedder call becomes a typed
 * `{ status: 'failed' }` outcome, matching research/pipeline.ts's `runStage`
 * shape, so the memory worker can mark the job failed without crashing. Every
 * attempt, success or failure, records usage.
 */

const state = vi.hoisted(() => ({
  summarizerBehavior: 'succeed' as 'succeed' | 'malformed' | 'throw',
  embedderBehavior: 'succeed' as 'succeed' | 'throw',
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
  createServiceRoleClient: () => ({}),
}));

vi.mock('@/lib/ai/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/gateway')>('@/lib/ai/gateway');

  return {
    ...actual,
    callStructured: async (deps: { usage: { record: (entry: unknown) => Promise<void> } }, args: { role: string }) => {
      if (state.summarizerBehavior === 'throw') {
        await deps.usage.record({ role: args.role, succeeded: false });
        throw new Error('transport failure');
      }

      if (state.summarizerBehavior === 'malformed') {
        await deps.usage.record({ role: args.role, succeeded: false });
        throw new actual.StructuredOutputError(args.role as never, 2, 'not json', new Error('bad shape'));
      }

      await deps.usage.record({ role: args.role, succeeded: true });
      return {
        data: {
          what_happened: 'They reached the harbor.',
          who_was_involved: ['Kestrel'],
          what_changed: ['Kestrel is now at the harbor'],
        },
        resolvedModel: 'test/summarizer',
        usedFallbackModel: false,
      };
    },
    embedText: async (deps: { usage: { record: (entry: unknown) => Promise<void> } }) => {
      if (state.embedderBehavior === 'throw') {
        await deps.usage.record({ role: 'embedder', succeeded: false });
        throw new actual.EmbeddingError('embedding request failed');
      }

      await deps.usage.record({ role: 'embedder', succeeded: true });
      return { embedding: [0.1, 0.2, 0.3], resolvedModel: 'test/embedder', usedFallbackModel: false };
    },
  };
});

const { generateChapterMemory } = await import('@/lib/memory/generate');

function recorder() {
  const calls: unknown[] = [];
  return { calls, record: async (entry: unknown) => void calls.push(entry) };
}

function baseArgs(usage: ReturnType<typeof recorder>) {
  return {
    chapterId: 'chapter-1',
    storyId: 'story-1',
    turnNumber: 3,
    prose: 'They walked to the harbor.',
    entities: [{ name: 'Kestrel', type: 'character' }],
    modelConfig: null,
    retrievalBias: 'precedent' as const,
    usage,
    budget: allowAllBudget,
  };
}

describe('generateChapterMemory', () => {
  it('returns a complete outcome with summary and embedding on success, recording usage for both calls', async () => {
    state.summarizerBehavior = 'succeed';
    state.embedderBehavior = 'succeed';
    const usage = recorder();

    const outcome = await generateChapterMemory(baseArgs(usage));

    expect(outcome.status).toBe('complete');
    if (outcome.status === 'complete') {
      expect(outcome.summary).toContain('harbor');
      expect(outcome.embedding).toEqual([0.1, 0.2, 0.3]);
    }
    expect(usage.calls).toEqual([
      { role: 'summarizer', succeeded: true },
      { role: 'embedder', succeeded: true },
    ]);
  });

  it('embeds the generated summary text, not the raw prose', async () => {
    state.summarizerBehavior = 'succeed';
    state.embedderBehavior = 'succeed';
    const usage = recorder();

    const outcome = await generateChapterMemory(baseArgs(usage));

    expect(outcome.status).toBe('complete');
    if (outcome.status === 'complete') {
      expect(outcome.summary).not.toBe('They walked to the harbor.');
    }
  });

  it('returns a failed outcome (not a throw) when the summarizer response is malformed', async () => {
    state.summarizerBehavior = 'malformed';
    const usage = recorder();

    const outcome = await generateChapterMemory(baseArgs(usage));

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toContain('failed validation');
    }
    expect(usage.calls).toEqual([{ role: 'summarizer', succeeded: false }]);
  });

  it('returns a failed outcome when the summarizer call throws a transport error', async () => {
    state.summarizerBehavior = 'throw';
    const usage = recorder();

    const outcome = await generateChapterMemory(baseArgs(usage));

    expect(outcome).toEqual({ status: 'failed', error: 'transport failure' });
  });

  it('returns a failed outcome when the embedder call fails, after a successful summary', async () => {
    state.summarizerBehavior = 'succeed';
    state.embedderBehavior = 'throw';
    const usage = recorder();

    const outcome = await generateChapterMemory(baseArgs(usage));

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toContain('embedding request failed');
    }
    expect(usage.calls).toEqual([
      { role: 'summarizer', succeeded: true },
      { role: 'embedder', succeeded: false },
    ]);
  });
});
