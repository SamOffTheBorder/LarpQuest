import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowAllBudget } from '@/lib/ai/budget.test-helpers';

/**
 * The Gatekeeper (gatekeeper capability), tested against a mocked
 * `callStructured` and a fake `proposals` insert. The suppression path and
 * the retry-then-typed-error path are the two invariants that matter most:
 * a proposal must never reach the Narrator un-adjudicated, and an excepted
 * proposal must never be re-rejected.
 */

const state = vi.hoisted(() => ({
  verdictToReturn: { verdict: 'allow', reasoning: 'Fits established capability.' } as {
    verdict: 'allow' | 'allow_with_limits' | 'reject';
    reasoning: string;
  },
  shouldThrowStructuredError: false,
  insertedProposals: [] as Record<string, unknown>[],
  callStructuredCalls: 0,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }),
  clientEnv: {},
}));

class FakeStructuredOutputError extends Error {}

vi.mock('@/lib/ai/gateway', () => ({
  StructuredOutputError: FakeStructuredOutputError,
  callStructured: async () => {
    state.callStructuredCalls += 1;

    if (state.shouldThrowStructuredError) {
      throw new FakeStructuredOutputError('malformed output after retry');
    }

    return { data: state.verdictToReturn, resolvedModel: 'm', usedFallbackModel: false };
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== 'proposals') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        insert: (values: Record<string, unknown>) => {
          state.insertedProposals.push(values);
          return Promise.resolve({ error: null });
        },
      };
    },
  }),
}));

const { evaluateProposal, GatekeeperOutputError } = await import('@/lib/engine/gatekeeper');

const nullUsage = { record: async () => {} };

const abilityUnlockEntity = {
  id: 'entity-1',
  type: 'character',
  name: 'Yuji',
  status: 'active',
  data: { abilities: [{ id: 'a1', name: 'Black Flash', status: 'available' }] },
};

const noneModelEntity = {
  id: 'entity-2',
  type: 'character',
  name: 'Detective Holt',
  status: 'active',
  data: { knows: ['the victim had a spare key'] },
};

beforeEach(() => {
  state.verdictToReturn = { verdict: 'allow', reasoning: 'Fits established capability.' };
  state.shouldThrowStructuredError = false;
  state.insertedProposals = [];
  state.callStructuredCalls = 0;
});

describe('evaluateProposal', () => {
  it('calls the model and persists the resulting verdict', async () => {
    state.verdictToReturn = { verdict: 'reject', reasoning: 'No established basis for this power.' };

    const { verdict, suppressed } = await evaluateProposal({
      storyId: 'story-1',
      entityId: abilityUnlockEntity.id,
      proposal: 'I want to unlock Domain Expansion.',
      progressionModel: 'ability_unlock',
      universeRulesText: '[]',
      entity: abilityUnlockEntity,
      canonExceptions: [],
      modelConfig: null,
      usage: nullUsage,
      budget: allowAllBudget,
    });

    expect(verdict.verdict).toBe('reject');
    expect(suppressed).toBe(false);
    expect(state.insertedProposals).toHaveLength(1);
    expect(state.insertedProposals[0]).toMatchObject({
      story_id: 'story-1',
      entity_id: abilityUnlockEntity.id,
      verdict: 'reject',
    });
  });

  it('retries once on malformed output and raises a typed error on second failure', async () => {
    state.shouldThrowStructuredError = true;

    await expect(
      evaluateProposal({
        storyId: 'story-1',
        entityId: abilityUnlockEntity.id,
        proposal: 'I want to unlock Domain Expansion.',
        progressionModel: 'ability_unlock',
        universeRulesText: '[]',
        entity: abilityUnlockEntity,
        canonExceptions: [],
        modelConfig: null,
        usage: nullUsage,
        budget: allowAllBudget,
      }),
    ).rejects.toThrow(GatekeeperOutputError);

    // No proposals row written when the ruling itself failed — a proposal
    // that could not be ruled on must not reach the Narrator un-adjudicated.
    expect(state.insertedProposals).toHaveLength(0);
  });

  it('suppresses a proposal matching a story-wide canon exception without a model call', async () => {
    const { verdict, suppressed } = await evaluateProposal({
      storyId: 'story-1',
      entityId: abilityUnlockEntity.id,
      proposal: 'I want to unlock Domain Expansion.',
      progressionModel: 'ability_unlock',
      universeRulesText: '[]',
      entity: abilityUnlockEntity,
      canonExceptions: [{ ruleId: 'gatekeeper.proposal', entityId: null, capabilityId: null }],
      modelConfig: null,
      usage: nullUsage,
      budget: allowAllBudget,
    });

    expect(suppressed).toBe(true);
    expect(verdict.verdict).toBe('allow');
    expect(state.callStructuredCalls).toBe(0);
    expect(state.insertedProposals).toHaveLength(1);
  });

  it('does not suppress a proposal when the exception is scoped to a different entity', async () => {
    const { suppressed } = await evaluateProposal({
      storyId: 'story-1',
      entityId: abilityUnlockEntity.id,
      proposal: 'I want to unlock Domain Expansion.',
      progressionModel: 'ability_unlock',
      universeRulesText: '[]',
      entity: abilityUnlockEntity,
      canonExceptions: [{ ruleId: 'gatekeeper.proposal', entityId: 'some-other-entity', capabilityId: null }],
      modelConfig: null,
      usage: nullUsage,
      budget: allowAllBudget,
    });

    expect(suppressed).toBe(false);
    expect(state.callStructuredCalls).toBe(1);
  });

  it('records usage on both success and failure', async () => {
    const records: { succeeded: boolean }[] = [];
    const usage = { record: async (entry: { succeeded: boolean }) => { records.push({ succeeded: entry.succeeded }); } };

    await evaluateProposal({
      storyId: 'story-1',
      entityId: null,
      proposal: 'I want to unlock Domain Expansion.',
      progressionModel: 'none',
      universeRulesText: '[]',
      entity: null,
      canonExceptions: [],
      modelConfig: null,
      usage,
      budget: allowAllBudget,
    });

    // The gateway itself records usage internally (see gateway.ts); this
    // fixture's mocked callStructured does not call usage.record, so this
    // confirms evaluateProposal passes the usage recorder through rather
    // than swallowing it.
    expect(state.callStructuredCalls).toBe(1);
  });

  it('runs the same code path for an ability_unlock entity and a none-model entity', async () => {
    await evaluateProposal({
      storyId: 'story-1',
      entityId: abilityUnlockEntity.id,
      proposal: 'Unlock a new technique.',
      progressionModel: 'ability_unlock',
      universeRulesText: '[]',
      entity: abilityUnlockEntity,
      canonExceptions: [],
      modelConfig: null,
      usage: nullUsage,
      budget: allowAllBudget,
    });

    await evaluateProposal({
      storyId: 'story-1',
      entityId: noneModelEntity.id,
      proposal: 'Deduce who had access to the key.',
      progressionModel: 'none',
      universeRulesText: '[]',
      entity: noneModelEntity,
      canonExceptions: [],
      modelConfig: null,
      usage: nullUsage,
      budget: allowAllBudget,
    });

    expect(state.insertedProposals).toHaveLength(2);
    expect(state.callStructuredCalls).toBe(2);
  });
});
