import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end proof of Phase 6's exit criterion (build plan Part 10): "A
 * player proposing an unearned power gets a reasoned in-universe rejection."
 *
 * Follows Phase 5's exit-criterion pattern (exit-criterion.test.ts): drive
 * the real exported functions across the Gatekeeper, canon-exceptions, and
 * consistency-report modules against a mocked gateway/database, rather than
 * re-deriving behavior already covered unit-by-unit in gatekeeper.test.ts,
 * canon-exceptions.test.ts, and consistency-report.test.ts. This test's job
 * is to prove the full narrative arc holds together: propose -> reject ->
 * visible in the consistency report -> GM override -> the same proposal is
 * no longer re-rejected. Full chapter generation (the Narrator prompt
 * actually receiving the ruling) is covered by turns.test.ts and
 * gatekeeper.ts's `evaluateTurnProposals` wiring is exercised in turns.ts
 * directly; this test starts one level below that, at the Gatekeeper/
 * canon-exceptions/consistency-report boundary, since reproducing the full
 * streaming narrator mock here would just re-derive turns.test.ts.
 */

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }),
  clientEnv: {},
}));

const state = vi.hoisted(() => ({
  members: new Map<string, string>(), // `${storyId}:${userId}` -> role
  chapters: new Map<string, Record<string, unknown>>(),
  proposals: new Map<string, Record<string, unknown>>(),
  canonExceptions: [] as Record<string, unknown>[],
  gatekeeperVerdictToReturn: { verdict: 'reject' as const, reasoning: 'Yuji has not earned this technique.' },
}));

class FakeStructuredOutputError extends Error {}

vi.mock('@/lib/ai/gateway', () => ({
  StructuredOutputError: FakeStructuredOutputError,
  callStructured: async () => ({
    data: state.gatekeeperVerdictToReturn,
    resolvedModel: 'test/gatekeeper',
    usedFallbackModel: false,
  }),
}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const filters: Record<string, unknown> = {};

    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      order() {
        return builder;
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const role = state.members.get(`${filters.story_id}:${filters.user_id}`);
          return { data: role !== undefined ? { role } : null, error: null };
        }
        if (table === 'chapters') {
          return { data: state.chapters.get(filters.id as string) ?? null, error: null };
        }
        if (table === 'proposals') {
          return { data: state.proposals.get(filters.id as string) ?? null, error: null };
        }
        return { data: null, error: null };
      },
      insert(values: Record<string, unknown>) {
        if (table === 'proposals') {
          const id = `proposal-${state.proposals.size + 1}`;
          const row = { id, created_at: '2026-08-21T00:00:00Z', gm_override: false, ...values };
          state.proposals.set(id, row);
          return Promise.resolve({ error: null });
        }
        if (table === 'canon_exceptions') {
          const row = { id: `exc-${state.canonExceptions.length + 1}`, created_at: '2026-08-21T00:00:00Z', ...values };
          state.canonExceptions.push(row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        }
        return { select: () => ({ single: async () => ({ data: values, error: null }) }) };
      },
      update(values: Record<string, unknown>) {
        return {
          async eq(_column: string, value: unknown) {
            if (table === 'proposals') {
              const existing = state.proposals.get(value as string);
              if (existing !== undefined) state.proposals.set(value as string, { ...existing, ...values });
            }
            return { error: null };
          },
        };
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        if (table === 'canon_exceptions') {
          resolve({ data: state.canonExceptions.filter((row) => row.story_id === filters.story_id), error: null });
          return;
        }
        if (table === 'proposals') {
          resolve({
            data: [...state.proposals.values()].filter((row) => row.story_id === filters.story_id),
            error: null,
          });
          return;
        }
        resolve({ data: [], error: null });
      },
    };

    return builder;
  }

  return { createServiceRoleClient: () => ({ from }) };
});

const { evaluateProposal } = await import('@/lib/engine/gatekeeper');
const { overrideProposal } = await import('@/lib/engine/canon-exceptions');
const { getStoryProposalHistory } = await import('@/lib/engine/consistency-report');
const { isSuppressed } = await import('@/lib/engine/rules/exceptions');

const STORY = 'story-1';
const GM = 'gm-1';
const YUJI = 'entity-yuji';

beforeEach(() => {
  state.members.clear();
  state.chapters.clear();
  state.proposals.clear();
  state.canonExceptions.length = 0;
  state.gatekeeperVerdictToReturn = { verdict: 'reject', reasoning: 'Yuji has not earned this technique.' };

  state.members.set(`${STORY}:${GM}`, 'gm');
});

describe('Phase 6 exit criterion: a player proposing an unearned power gets a reasoned in-universe rejection', () => {
  it('proposes, is rejected with reasoning, appears in the report, gets overridden, and is not re-rejected', async () => {
    const nullUsage = { record: async () => {} };
    const entity = { id: YUJI, type: 'character', name: 'Yuji', status: 'active', data: { abilities: [] } };

    // 1. Player proposes something their character hasn't earned.
    const { verdict, suppressed } = await evaluateProposal({
      storyId: STORY,
      entityId: YUJI,
      proposal: 'I unlock Domain Expansion.',
      progressionModel: 'ability_unlock',
      universeRulesText: '[]',
      entity,
      canonExceptions: [],
      modelConfig: null,
      usage: nullUsage,
    });

    // 2. The Gatekeeper gives a reasoned in-universe rejection — this is the
    // exit criterion's core claim.
    expect(suppressed).toBe(false);
    expect(verdict.verdict).toBe('reject');
    expect(verdict.reasoning.length).toBeGreaterThan(0);

    // 3. The rejection is visible in the story's consistency report.
    const historyBeforeOverride = await getStoryProposalHistory(STORY, GM);
    expect(historyBeforeOverride).toHaveLength(1);
    expect(historyBeforeOverride[0]).toMatchObject({ verdict: 'reject', gmOverride: false });

    const proposalId = historyBeforeOverride[0]!.id;

    // 4. The GM overrides the rejection — a legitimate creative choice — and
    // the override is recorded permanently without altering the original
    // ruling.
    const exception = await overrideProposal(proposalId, GM, 'This is the moment Yuji breaks through — allow it.');
    expect(exception.ruleId).toBe('gatekeeper.proposal');
    expect(exception.entityId).toBe(YUJI);

    const historyAfterOverride = await getStoryProposalHistory(STORY, GM);
    expect(historyAfterOverride[0]).toMatchObject({ verdict: 'reject', reasoning: verdict.reasoning, gmOverride: true });

    // 5. A subsequent identical proposal from the same entity is suppressed
    // — never re-rejected the same way again.
    const canonExceptions = [
      { ruleId: exception.ruleId, entityId: exception.entityId, capabilityId: exception.capabilityId },
    ];
    const laterProposalFlag = {
      ruleId: 'gatekeeper.proposal',
      severity: 'block' as const,
      description: 'x',
      entityId: YUJI,
    };
    expect(isSuppressed(laterProposalFlag, canonExceptions)).toBe(true);

    const { verdict: secondVerdict, suppressed: secondSuppressed } = await evaluateProposal({
      storyId: STORY,
      entityId: YUJI,
      proposal: 'I unlock Domain Expansion again.',
      progressionModel: 'ability_unlock',
      universeRulesText: '[]',
      entity,
      canonExceptions,
      modelConfig: null,
      usage: nullUsage,
    });

    expect(secondSuppressed).toBe(true);
    expect(secondVerdict.verdict).not.toBe('reject');
  });
});
