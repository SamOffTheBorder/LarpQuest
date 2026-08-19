import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Moderation pass verdicts and fail-open behavior. callStructured already
 * retries once internally (CLAUDE.md #7) — this file verifies moderate.ts's
 * own contract: pass/flag/block pass through verbatim, and a
 * StructuredOutputError (raised after the gateway's retries are exhausted)
 * degrades to flag rather than throwing.
 */

const state = vi.hoisted(() => ({
  submissions: [] as { content: string }[],
  usageRecords: [] as unknown[],
  callBehavior: 'pass' as 'pass' | 'flag' | 'block' | 'throw',
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }),
  clientEnv: {},
}));

class FakeStructuredOutputError extends Error {}

vi.mock('@/lib/ai/gateway', () => ({
  StructuredOutputError: FakeStructuredOutputError,
  callStructured: async (deps: { usage: { record: (e: unknown) => Promise<void> } }) => {
    await deps.usage.record({ attempt: 'moderation' });

    if (state.callBehavior === 'throw') {
      throw new FakeStructuredOutputError('unparseable output after retry');
    }

    const verdict = state.callBehavior;
    return {
      data: { verdict, reason: `${verdict} reason` },
      resolvedModel: 'anthropic/claude-haiku-4.5',
      usedFallbackModel: false,
    };
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        then(resolve: (result: { data: unknown; error: null }) => void) {
          if (table === 'submissions') {
            resolve({ data: state.submissions, error: null });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
    },
  }),
}));

const { moderateTurnSubmissions } = await import('@/lib/moderation/moderate');

beforeEach(() => {
  state.submissions = [{ content: 'I search the ruin.' }];
  state.usageRecords = [];
  state.callBehavior = 'pass';
});

const usage = {
  record: async (entry: unknown) => {
    state.usageRecords.push(entry);
  },
};

describe('moderateTurnSubmissions', () => {
  it('pass verdict passes through', async () => {
    const result = await moderateTurnSubmissions('turn-1', 'teen', null, 'story-1', usage);
    expect(result).toEqual({ verdict: 'pass', reason: 'pass reason', degraded: false });
  });

  it('flag verdict passes through', async () => {
    state.callBehavior = 'flag';
    const result = await moderateTurnSubmissions('turn-1', 'teen', null, 'story-1', usage);
    expect(result.verdict).toBe('flag');
    expect(result.degraded).toBe(false);
  });

  it('block verdict passes through', async () => {
    state.callBehavior = 'block';
    const result = await moderateTurnSubmissions('turn-1', 'mature', null, 'story-1', usage);
    expect(result.verdict).toBe('block');
    expect(result.degraded).toBe(false);
  });

  it('a StructuredOutputError after retry degrades to flag rather than throwing', async () => {
    state.callBehavior = 'throw';
    const result = await moderateTurnSubmissions('turn-1', 'teen', null, 'story-1', usage);
    expect(result.verdict).toBe('flag');
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain('failed after retry');
  });

  it('records usage for every attempt, including the failing one', async () => {
    state.callBehavior = 'throw';
    await moderateTurnSubmissions('turn-1', 'teen', null, 'story-1', usage);
    expect(state.usageRecords).toHaveLength(1);
  });

  it('zero submissions passes without calling the model', async () => {
    state.submissions = [];
    const result = await moderateTurnSubmissions('turn-1', 'teen', null, 'story-1', usage);
    expect(result).toEqual({ verdict: 'pass', reason: 'No submissions to moderate.', degraded: false });
    expect(state.usageRecords).toHaveLength(0);
  });
});
