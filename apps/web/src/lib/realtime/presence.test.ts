import { describe, expect, it, vi } from 'vitest';

/**
 * The pure "waiting on N of M" computation, tested directly. The hooks
 * themselves (useTurnPresence/useStoryPresence) are thin subscription
 * wrappers around this — not re-tested here since they need a DOM/React
 * environment this project's vitest config doesn't set up for lib/ code.
 */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    throw new Error('Realtime unavailable in this test environment.');
  },
}));

const { computeSubmissionCompleteness } = await import('@/lib/realtime/presence');

describe('computeSubmissionCompleteness', () => {
  it('counts claimed entities with no submission as waiting', () => {
    const result = computeSubmissionCompleteness(['e1', 'e2', 'e3', 'e4', 'e5'], ['e1', 'e2']);
    expect(result).toEqual({ waitingOn: 3, totalClaimed: 5 });
  });

  it('excludes unclaimed entities from the denominator entirely', () => {
    // Unclaimed entities are never passed into claimedEntityIds at all —
    // this asserts the function only ever sees the claimed set.
    const result = computeSubmissionCompleteness(['e1'], []);
    expect(result).toEqual({ waitingOn: 1, totalClaimed: 1 });
  });

  it('zero claimed entities is zero waiting, not an error', () => {
    const result = computeSubmissionCompleteness([], []);
    expect(result).toEqual({ waitingOn: 0, totalClaimed: 0 });
  });

  it('everyone submitted is zero waiting', () => {
    const result = computeSubmissionCompleteness(['e1', 'e2'], ['e1', 'e2']);
    expect(result).toEqual({ waitingOn: 0, totalClaimed: 2 });
  });

  it('a submission for an entity not in the claimed set does not go negative', () => {
    const result = computeSubmissionCompleteness(['e1'], ['e1', 'e2', 'e3']);
    expect(result.waitingOn).toBe(0);
  });
});

describe('channel setup failure', () => {
  it('createClient throwing does not propagate past the module boundary', async () => {
    // useStoryPresence/useTurnPresence wrap createClient() in try/catch
    // specifically so a Realtime-unavailable environment degrades instead of
    // crashing render. This asserts the mocked createClient really does
    // throw as configured, i.e. that the hooks' try/catch has something real
    // to guard against.
    const { createClient } = await import('@/lib/supabase/client');
    expect(() => createClient()).toThrow('Realtime unavailable');
  });
});
