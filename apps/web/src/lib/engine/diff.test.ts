import { describe, expect, it } from 'vitest';

import type { EntityData } from '@/lib/engine/context';
import { applyDiffs, diffSchema, invertDiff, type Diff } from './diff';

const ENTITY_A = '11111111-1111-4111-8111-111111111111';
const ENTITY_B = '22222222-2222-4222-8222-222222222222';
const MISSING = '33333333-3333-4333-8333-333333333333';

function diff(overrides: Partial<Diff> = {}): Diff {
  return {
    entity_id: ENTITY_A,
    field: 'status',
    from: 'healthy',
    to: 'injured',
    evidence: 'She staggered, clutching her side.',
    ...overrides,
  };
}

function entities(): Map<string, EntityData> {
  return new Map<string, EntityData>([
    [ENTITY_A, { status: 'healthy', name: 'Aya' }],
    [ENTITY_B, { status: 'healthy', knows: ['the alibi is false'] }],
  ]);
}

describe('applyDiffs', () => {
  it('applies a diff whose from-value matches', () => {
    const result = applyDiffs(entities(), [diff()]);

    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.updated.get(ENTITY_A)).toEqual({ status: 'injured', name: 'Aya' });
  });

  it('does not mutate the input entities', () => {
    const input = entities();
    applyDiffs(input, [diff()]);

    expect(input.get(ENTITY_A)).toEqual({ status: 'healthy', name: 'Aya' });
  });

  it('rejects a stale diff instead of clobbering', () => {
    const result = applyDiffs(entities(), [diff({ from: 'critical' })]);

    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe('stale_value');
    expect(result.rejected[0]?.actual).toBe('healthy');
    expect(result.updated.size).toBe(0);
  });

  it('rejects a diff naming an unknown entity', () => {
    const result = applyDiffs(entities(), [diff({ entity_id: MISSING })]);

    expect(result.rejected[0]?.reason).toBe('unknown_entity');
  });

  it('does not let one bad diff block the rest of the batch', () => {
    const result = applyDiffs(entities(), [
      diff({ entity_id: MISSING }),
      diff({ from: 'wrong' }),
      diff({ entity_id: ENTITY_B, field: 'status', from: 'healthy', to: 'critical' }),
    ]);

    expect(result.rejected).toHaveLength(2);
    expect(result.applied).toHaveLength(1);
    expect(result.updated.get(ENTITY_B)).toMatchObject({ status: 'critical' });
  });

  it('chains sequential diffs against the same field', () => {
    const result = applyDiffs(entities(), [
      diff({ from: 'healthy', to: 'injured' }),
      diff({ from: 'injured', to: 'critical' }),
    ]);

    expect(result.applied).toHaveLength(2);
    expect(result.updated.get(ENTITY_A)).toMatchObject({ status: 'critical' });
  });

  it('treats absent and null as equivalent for a new field', () => {
    const result = applyDiffs(entities(), [
      diff({ field: 'injuries', from: null, to: ['bruised ribs'] }),
    ]);

    expect(result.applied).toHaveLength(1);
    expect(result.updated.get(ENTITY_A)).toMatchObject({ injuries: ['bruised ribs'] });
  });

  it('compares object and array values structurally, ignoring key order', () => {
    const store = new Map<string, EntityData>([
      [ENTITY_A, { bonds: { rell: 2, aya: 1 } }],
    ]);

    const result = applyDiffs(store, [
      diff({ field: 'bonds', from: { aya: 1, rell: 2 }, to: { aya: 1, rell: 3 } }),
    ]);

    expect(result.applied).toHaveLength(1);
  });

  it('handles a universe with no power fields at all', () => {
    // Same code path as the shonen case above — no genre branching.
    const result = applyDiffs(entities(), [
      diff({
        entity_id: ENTITY_B,
        field: 'knows',
        from: ['the alibi is false'],
        to: ['the alibi is false', 'the butler lied'],
      }),
    ]);

    expect(result.applied).toHaveLength(1);
  });
});

describe('invertDiff', () => {
  it('reverses an applied diff for rollback', () => {
    const result = applyDiffs(entities(), [diff()]);
    const applied = result.applied[0];

    expect(applied).toBeDefined();

    const reversal = invertDiff(applied!);

    expect(reversal.from).toBe('injured');
    expect(reversal.to).toBe('healthy');
    expect(reversal.evidence).toContain('Reversal of');
  });

  it('round-trips back to the original state', () => {
    const store = entities();
    const forward = applyDiffs(store, [diff()]);

    const afterForward = new Map(store);
    for (const [id, data] of forward.updated) {
      afterForward.set(id, data);
    }

    const back = applyDiffs(afterForward, [invertDiff(forward.applied[0]!)]);

    expect(back.updated.get(ENTITY_A)).toEqual({ status: 'healthy', name: 'Aya' });
  });
});

describe('diffSchema', () => {
  it('rejects a diff with no evidence', () => {
    expect(diffSchema.safeParse({ ...diff(), evidence: '' }).success).toBe(false);
  });

  it('rejects a non-uuid entity id', () => {
    expect(diffSchema.safeParse({ ...diff(), entity_id: 'nope' }).success).toBe(false);
  });

  it('accepts null and structured values for from/to', () => {
    expect(diffSchema.safeParse(diff({ from: null, to: { a: 1 } })).success).toBe(true);
  });
});
