import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The validator loop orchestrator (validator-loop capability), tested against
 * a mocked `runValidatorCall` so each severity/retry path is exercised
 * directly rather than through the full turns.ts generation loop (that
 * integration is covered by turns.test.ts and exit-criterion.test.ts).
 */

const state = vi.hoisted(() => ({
  violations: [] as { rule_id: string; violated: boolean; description: string; entity_id?: string; capability_id?: string }[],
  canonExceptionRows: [] as Record<string, unknown>[],
  usageRecords: [] as { role: string; succeeded: boolean }[],
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

vi.mock('@/lib/ai/usage', () => ({
  createUsageRecorder: () => ({
    record: async (entry: { role: string; succeeded: boolean }) => {
      state.usageRecords.push({ role: entry.role, succeeded: entry.succeeded });
    },
  }),
}));

vi.mock('@/lib/ai/gateway', () => ({
  StructuredOutputError: class FakeStructuredOutputError extends Error {},
  callStructured: async (deps: { usage: { record: (entry: Record<string, unknown>) => Promise<void> } }) => {
    await deps.usage.record({ role: 'validator', model: 'm', promptTokens: 0, completionTokens: 0, costUsd: 0, succeeded: true, usedFallbackModel: false });
    return {
      data: { violations: state.violations },
      resolvedModel: 'm',
      usedFallbackModel: false,
    };
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
            resolve({ data: state.canonExceptionRows, error: null });
          },
        }),
      }),
    }),
  }),
}));

const { runValidation, loadCanonExceptions, buildBlockRetryAddendum, toValidationReportJson } = await import(
  '@/lib/engine/validator'
);

beforeEach(() => {
  state.violations = [];
  state.canonExceptionRows = [];
  state.usageRecords = [];
});

const baseArgs = {
  storyId: 'story-1',
  chapterDraft: 'A chapter draft.',
  progressionModel: 'ability_unlock',
  researchRules: [],
  entities: [],
  canonExceptions: [],
  modelConfig: null,
  userId: 'user-1',
};

describe('runValidation', () => {
  it('publishes when no violations are reported', async () => {
    state.violations = [];

    const outcome = await runValidation({ ...baseArgs, attemptCount: 1 });

    expect(outcome.action).toBe('publish');
    expect(outcome.flags).toEqual([]);
  });

  it('publishes with warn/log flags recorded rather than blocking', async () => {
    state.violations = [
      { rule_id: 'standard.intent_not_addressed', violated: true, description: 'Ignored a submission.' },
    ];

    const outcome = await runValidation({ ...baseArgs, attemptCount: 1 });

    expect(outcome.action).toBe('publish');
    expect(outcome.flags).toHaveLength(1);
    expect(outcome.flags[0]?.severity).toBe('warn');
  });

  it('retries on a block-severity flag under the retry cap', async () => {
    state.violations = [
      { rule_id: 'standard.dead_entity_acts', violated: true, description: 'A dead entity acted.' },
    ];

    const outcome = await runValidation({ ...baseArgs, attemptCount: 1 });

    expect(outcome).toMatchObject({ action: 'retry', blockingRuleIds: ['standard.dead_entity_acts'] });
  });

  it('still retries on the second block-severity attempt (attemptCount 2, cap 2)', async () => {
    state.violations = [
      { rule_id: 'standard.dead_entity_acts', violated: true, description: 'A dead entity acted.' },
    ];

    const outcome = await runValidation({ ...baseArgs, attemptCount: 2 });

    expect(outcome.action).toBe('retry');
  });

  it('fails the turn once the retry cap is exceeded', async () => {
    state.violations = [
      { rule_id: 'standard.dead_entity_acts', violated: true, description: 'A dead entity acted.' },
    ];

    const outcome = await runValidation({ ...baseArgs, attemptCount: 3 });

    expect(outcome).toMatchObject({ action: 'fail', blockingRuleIds: ['standard.dead_entity_acts'] });
  });

  it('records usage for the validator call', async () => {
    state.violations = [];

    await runValidation({ ...baseArgs, attemptCount: 1 });

    expect(state.usageRecords).toContainEqual({ role: 'validator', succeeded: true });
  });

  it('suppresses a violation matching a canon exception, so it does not block', async () => {
    state.violations = [
      { rule_id: 'standard.dead_entity_acts', violated: true, description: 'A dead entity acted.' },
    ];

    const outcome = await runValidation({
      ...baseArgs,
      attemptCount: 1,
      canonExceptions: [{ ruleId: 'standard.dead_entity_acts', entityId: null, capabilityId: null }],
    });

    expect(outcome.action).toBe('publish');
  });
});

describe('loadCanonExceptions', () => {
  it('maps rows into CanonException shape', async () => {
    state.canonExceptionRows = [{ rule_id: 'r1', entity_id: 'e1', capability_id: null }];

    const exceptions = await loadCanonExceptions('story-1');

    expect(exceptions).toEqual([{ ruleId: 'r1', entityId: 'e1', capabilityId: null }]);
  });
});

describe('buildBlockRetryAddendum', () => {
  it('includes only block-severity flags in the addendum', () => {
    const addendum = buildBlockRetryAddendum([
      { ruleId: 'r1', severity: 'block', description: 'block violation' },
      { ruleId: 'r2', severity: 'warn', description: 'warn violation' },
    ]);

    expect(addendum).toContain('block violation');
    expect(addendum).not.toContain('warn violation');
  });
});

describe('toValidationReportJson', () => {
  it('serializes flags with null defaults for absent entity/capability ids', () => {
    const json = toValidationReportJson([{ ruleId: 'r1', severity: 'log', description: 'd' }]);

    expect(json).toEqual([{ rule_id: 'r1', severity: 'log', description: 'd', entity_id: null, capability_id: null }]);
  });
});
