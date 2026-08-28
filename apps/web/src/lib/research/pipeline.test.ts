import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { applyStageOutput, type DraftDocument } from '@/lib/research/draft';
import type { ScopingResult } from '@/lib/research/schemas';
import { allowAllBudget } from '@/lib/ai/budget.test-helpers';

/**
 * The invariant under test: a malformed stage response never throws past
 * `runStage` — it becomes a typed `{ status: 'failed' }` outcome so the
 * orchestrator can continue to the next stage (research-pipeline spec, "One
 * stage's failure does not abort the draft"). Every attempt, success or
 * failure, must still report through the injected usage recorder.
 */

const state = vi.hoisted(() => ({
  behavior: 'succeed' as 'succeed' | 'malformed' | 'throw',
  response: {} as unknown,
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
    callStructured: async (
      deps: { usage: { record: (entry: unknown) => Promise<void> } },
      args: { role: string },
    ) => {
      if (state.behavior === 'throw') {
        await deps.usage.record({ role: args.role, succeeded: false });
        throw new Error('transport failure');
      }

      if (state.behavior === 'malformed') {
        await deps.usage.record({ role: args.role, succeeded: false });
        throw new actual.StructuredOutputError(
          args.role as never,
          2,
          'not json',
          new Error('bad shape'),
        );
      }

      await deps.usage.record({ role: args.role, succeeded: true });
      return { data: state.response, resolvedModel: 'test/model', usedFallbackModel: false };
    },
  };
});

// Imported after the mocks so pipeline.ts picks up the mocked gateway.
const { runStage, shouldRunProgressionStage } = await import('@/lib/research/pipeline');

function recorder() {
  const calls: unknown[] = [];
  return { calls, record: async (entry: unknown) => void calls.push(entry) };
}

describe('runStage', () => {
  it('returns a complete outcome and records usage on success', async () => {
    state.behavior = 'succeed';
    state.response = { ok: true };
    const usage = recorder();

    const outcome = await runStage({
      stage: 'scoping',
      systemPrompt: 'sys',
      userPrompt: 'user',
      schema: z.object({ ok: z.boolean() }),
      usage,
      budget: allowAllBudget,
    });

    expect(outcome).toEqual({ status: 'complete', output: { ok: true } });
    expect(usage.calls).toEqual([{ role: 'researcher', succeeded: true }]);
  });

  it('returns a failed outcome (not a throw) when structured output is malformed, and still records usage', async () => {
    state.behavior = 'malformed';
    const usage = recorder();

    const outcome = await runStage({
      stage: 'entities',
      systemPrompt: 'sys',
      userPrompt: 'user',
      schema: z.object({ ok: z.boolean() }),
      usage,
      budget: allowAllBudget,
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toContain('failed validation');
    }
    expect(usage.calls).toEqual([{ role: 'researcher', succeeded: false }]);
  });

  it('returns a failed outcome when the call throws a transport-level error', async () => {
    state.behavior = 'throw';
    const usage = recorder();

    const outcome = await runStage({
      stage: 'timeline',
      systemPrompt: 'sys',
      userPrompt: 'user',
      schema: z.object({ ok: z.boolean() }),
      usage,
      budget: allowAllBudget,
    });

    expect(outcome).toEqual({ status: 'failed', error: 'transport failure' });
  });
});

function scoping(hasPowerSystem: boolean): ScopingResult {
  return {
    media_type: { value: 'manga', confidence: 'high' },
    genre_tags: { value: ['shonen'], confidence: 'high' },
    has_power_system: { value: hasPowerSystem, confidence: 'high' },
    scale_ceiling: { value: 'planetary', confidence: 'medium' },
    primary_conflict_mode: { value: 'combat', confidence: 'high' },
    tone: { value: ['dark'], confidence: 'medium' },
    recommended_turn_modes: { value: ['action'], confidence: 'high' },
  };
}

describe('shouldRunProgressionStage', () => {
  it('is true when scoping reports a power system', () => {
    expect(shouldRunProgressionStage(scoping(true))).toBe(true);
  });

  it('is false when scoping reports no power system', () => {
    expect(shouldRunProgressionStage(scoping(false))).toBe(false);
  });
});

describe('applyStageOutput (draft merge)', () => {
  it('merges a stage result into the correct section, leaving other sections untouched', () => {
    const draft: DraftDocument = {
      auMarks: [],
      scoping: { status: 'accepted', content: scoping(true) },
    };

    const next = applyStageOutput(draft, 'rules_mechanics', { rules: [] });

    expect(next.scoping).toEqual(draft.scoping);
    expect(next.rulesMechanics).toEqual({ status: 'pending', content: { rules: [] } });
  });

  it('replacing a stage resets that section back to pending for re-review', () => {
    const draft: DraftDocument = {
      auMarks: [],
      timeline: {
        status: 'accepted',
        content: { starting_point: { value: 'x', confidence: 'high' } } as never,
      },
    };

    const next = applyStageOutput(draft, 'timeline', { starting_point: { value: 'y', confidence: 'high' } });

    expect(next.timeline).toEqual({
      status: 'pending',
      content: { starting_point: { value: 'y', confidence: 'high' } },
    });
  });
});
