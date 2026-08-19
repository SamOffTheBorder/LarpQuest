import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GM/owner overrides (canon-exceptions capability) against a fake database.
 * The two invariants under test: an override never touches the flag/proposal
 * it responds to, and only owner/gm may write one.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, string>(), // `${storyId}:${userId}` -> role
  chapters: new Map<string, Record<string, unknown>>(),
  proposals: new Map<string, Record<string, unknown>>(),
  canonExceptions: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

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
              if (existing !== undefined) {
                state.proposals.set(value as string, { ...existing, ...values });
              }
            }
            return { error: null };
          },
        };
      },
    };

    return builder;
  }

  return { createServiceRoleClient: () => ({ from }) };
});

const { overrideValidationFlag, overrideProposal, EmptyExceptionNoteError } = await import(
  '@/lib/engine/canon-exceptions'
);

const STORY = 'story-1';
const GM = 'gm-1';
const PLAYER = 'player-1';

beforeEach(() => {
  state.members.clear();
  state.chapters.clear();
  state.proposals.clear();
  state.canonExceptions.length = 0;

  state.members.set(`${STORY}:${GM}`, 'gm');
  state.members.set(`${STORY}:${PLAYER}`, 'player');

  state.chapters.set('chapter-1', { story_id: STORY, validation_report: [{ rule_id: 'standard.dead_entity_acts' }] });
  state.proposals.set('proposal-1', { story_id: STORY, entity_id: 'entity-1', verdict: 'reject', reasoning: 'No basis.' });
});

describe('overrideValidationFlag', () => {
  it('writes a canon exception without touching the chapter row', async () => {
    const before = state.chapters.get('chapter-1');

    const exception = await overrideValidationFlag(
      'chapter-1',
      GM,
      'standard.dead_entity_acts',
      { entityId: 'entity-1' },
      'Established this is a resurrection-capable universe.',
    );

    expect(exception.ruleId).toBe('standard.dead_entity_acts');
    expect(exception.entityId).toBe('entity-1');
    expect(state.chapters.get('chapter-1')).toEqual(before);
  });

  it('rejects an empty reason', async () => {
    await expect(
      overrideValidationFlag('chapter-1', GM, 'standard.dead_entity_acts', {}, '   '),
    ).rejects.toThrow(EmptyExceptionNoteError);

    expect(state.canonExceptions).toHaveLength(0);
  });

  it('rejects a non-owner/gm caller', async () => {
    await expect(
      overrideValidationFlag('chapter-1', PLAYER, 'standard.dead_entity_acts', {}, 'A reason.'),
    ).rejects.toThrow();

    expect(state.canonExceptions).toHaveLength(0);
  });

  it('writes a story-wide exception when no scope is given', async () => {
    const exception = await overrideValidationFlag('chapter-1', GM, 'standard.dead_entity_acts', {}, 'Disable this rule.');

    expect(exception.entityId).toBeNull();
    expect(exception.capabilityId).toBeNull();
  });
});

describe('overrideProposal', () => {
  it('writes a canon exception and sets gm_override without altering verdict/reasoning', async () => {
    const exception = await overrideProposal('proposal-1', GM, 'GM allows it this once, as a plot twist.');

    expect(exception.ruleId).toBe('gatekeeper.proposal');
    expect(exception.entityId).toBe('entity-1');

    const proposal = state.proposals.get('proposal-1');
    expect(proposal?.gm_override).toBe(true);
    expect(proposal?.verdict).toBe('reject');
    expect(proposal?.reasoning).toBe('No basis.');
  });

  it('rejects a non-owner/gm caller', async () => {
    await expect(overrideProposal('proposal-1', PLAYER, 'A reason.')).rejects.toThrow();
  });
});

describe('override suppresses future flags/proposals (integration, spans rules/exceptions.ts)', () => {
  it('a validation flag matching an override scope is suppressed by isSuppressed', async () => {
    const { isSuppressed } = await import('@/lib/engine/rules/exceptions');

    const exception = await overrideValidationFlag(
      'chapter-1',
      GM,
      'standard.dead_entity_acts',
      { entityId: 'entity-1' },
      'This universe allows resurrection.',
    );

    const laterFlag = { ruleId: 'standard.dead_entity_acts', severity: 'block' as const, description: 'x', entityId: 'entity-1' };

    expect(
      isSuppressed(laterFlag, [{ ruleId: exception.ruleId, entityId: exception.entityId, capabilityId: exception.capabilityId }]),
    ).toBe(true);
  });

  it('an overridden proposal is suppressed by isSuppressed for the same entity', async () => {
    const { isSuppressed } = await import('@/lib/engine/rules/exceptions');

    const exception = await overrideProposal('proposal-1', GM, 'Allowed as a plot twist.');

    const laterProposalFlag = { ruleId: 'gatekeeper.proposal', severity: 'block' as const, description: 'x', entityId: 'entity-1' };

    expect(
      isSuppressed(laterProposalFlag, [
        { ruleId: exception.ruleId, entityId: exception.entityId, capabilityId: exception.capabilityId },
      ]),
    ).toBe(true);
  });
});
