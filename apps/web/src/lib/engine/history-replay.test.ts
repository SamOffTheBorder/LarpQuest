import { describe, expect, it } from 'vitest';

import type { EntityData } from '@/lib/engine/context';
import { applyDiffs, invertDiff, type AppliedDiff, type Diff } from '@/lib/engine/diff';

/**
 * Entity state must be fully reconstructible by replaying entity_history alone
 * (entity-state spec, "Append-only entity history"). If it is not, the history
 * is decoration rather than a ledger, and rollback cannot be trusted.
 *
 * These tests replay history the way the database stores it — an ordered
 * sequence of diffs — and assert the result matches the live state.
 */

interface HistoryRow {
  entityId: string;
  diff: Diff;
  isReversal: boolean;
}

/** Rebuild entity data from an ordered history, starting from empty. */
function replay(rows: readonly HistoryRow[]): Map<string, EntityData> {
  const state = new Map<string, EntityData>();

  for (const row of rows) {
    const current = state.get(row.entityId) ?? {};
    state.set(row.entityId, { ...current, [row.diff.field]: row.diff.to });
  }

  return state;
}

function record(entityId: string, applied: readonly AppliedDiff[]): HistoryRow[] {
  return applied.map((entry) => ({ entityId, diff: entry.diff, isReversal: false }));
}

describe('entity history replay', () => {
  it('reconstructs current state from history alone', () => {
    const entityId = '11111111-1111-4111-8111-111111111111';
    const entities = new Map<string, EntityData>([[entityId, {}]]);

    const batchOne: Diff[] = [
      { entity_id: entityId, field: 'location', from: null, to: 'harbor', evidence: 'e1' },
      { entity_id: entityId, field: 'morale', from: null, to: 3, evidence: 'e2' },
    ];

    const first = applyDiffs(entities, batchOne);
    const afterFirst = first.updated.get(entityId) ?? {};

    const batchTwo: Diff[] = [
      { entity_id: entityId, field: 'location', from: 'harbor', to: 'citadel', evidence: 'e3' },
    ];

    const second = applyDiffs(new Map([[entityId, afterFirst]]), batchTwo);
    const liveState = second.updated.get(entityId) ?? {};

    const history = [...record(entityId, first.applied), ...record(entityId, second.applied)];
    const replayed = replay(history);

    expect(replayed.get(entityId)).toEqual(liveState);
    expect(liveState).toEqual({ location: 'citadel', morale: 3 });
  });

  it('reconstructs state for entities whose data the engine has never seen', () => {
    // The engine must not care what the fields are called. A structurally
    // different universe replays identically.
    const entityId = '22222222-2222-4222-8222-222222222222';
    const entities = new Map<string, EntityData>([[entityId, {}]]);

    const diffs: Diff[] = [
      {
        entity_id: entityId,
        field: 'quantum_signature',
        from: null,
        to: { phase: 'inverted', harmonics: [1, 618] },
        evidence: 'e1',
      },
      { entity_id: entityId, field: 'debt_to_the_choir', from: null, to: 7, evidence: 'e2' },
    ];

    const result = applyDiffs(entities, diffs);
    const replayed = replay(record(entityId, result.applied));

    expect(replayed.get(entityId)).toEqual(result.updated.get(entityId));
  });

  it('restores prior state when a chapter is rolled back', () => {
    const entityId = '33333333-3333-4333-8333-333333333333';
    const before: EntityData = { location: 'harbor', morale: 3 };

    const chapterDiffs: Diff[] = [
      { entity_id: entityId, field: 'location', from: 'harbor', to: 'citadel', evidence: 'e1' },
      { entity_id: entityId, field: 'morale', from: 3, to: 1, evidence: 'e2' },
    ];

    const applied = applyDiffs(new Map([[entityId, before]]), chapterDiffs);
    const after = applied.updated.get(entityId) ?? {};

    expect(after).toEqual({ location: 'citadel', morale: 1 });

    // Reversal in reverse chronological order, as compensating rows.
    const reversals = [...applied.applied].reverse().map(invertDiff);
    const rolledBack = applyDiffs(new Map([[entityId, after]]), reversals);

    expect(rolledBack.updated.get(entityId)).toEqual(before);
    expect(rolledBack.rejected).toHaveLength(0);
  });

  it('leaves history intact when a diff is rejected', () => {
    // A rejected diff must not appear in history: history records what was
    // applied, and a conflicted diff was not.
    const entityId = '44444444-4444-4444-8444-444444444444';
    const entities = new Map<string, EntityData>([[entityId, { morale: 3 }]]);

    const result = applyDiffs(entities, [
      { entity_id: entityId, field: 'morale', from: 99, to: 1, evidence: 'stale' },
    ]);

    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(replay(record(entityId, result.applied)).size).toBe(0);
  });
});
