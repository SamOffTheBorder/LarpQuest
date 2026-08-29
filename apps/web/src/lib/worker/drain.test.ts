import { describe, expect, it, vi } from 'vitest';

import { drainQueue } from './drain';

/**
 * The drain loop is what makes a once-daily cron viable: without it a single
 * invocation clears one row. The cases that matter are the ones that would
 * either stall a story (stopping too early) or hang a serverless function
 * (never stopping).
 */

function runnerReturning<T extends { claimed: boolean }>(outcomes: T[]) {
  let index = 0;
  return vi.fn(async (): Promise<T | { claimed: false }> => {
    const next = outcomes[index] ?? { claimed: false as const };
    index += 1;
    return next;
  });
}

describe('drainQueue', () => {
  it('processes every queued job until the queue reports empty', async () => {
    const runOne = runnerReturning([{ claimed: true }, { claimed: true }, { claimed: false }]);

    const result = await drainQueue(runOne);

    expect(result.processed).toBe(2);
    expect(result.stoppedBecause).toBe('empty');
    expect(runOne).toHaveBeenCalledTimes(3);
  });

  it('returns immediately when the queue is empty', async () => {
    const runOne = runnerReturning([{ claimed: false }]);

    const result = await drainQueue(runOne);

    expect(result.processed).toBe(0);
    expect(result.stoppedBecause).toBe('empty');
    expect(runOne).toHaveBeenCalledTimes(1);
  });

  it('stops at the job cap without draining further', async () => {
    const runOne = vi.fn(async () => ({ claimed: true }));

    const result = await drainQueue(runOne, { maxJobs: 3 });

    expect(result.processed).toBe(3);
    expect(result.stoppedBecause).toBe('max_jobs');
    expect(runOne).toHaveBeenCalledTimes(3);
  });

  it('stops when the wall-clock budget is exhausted', async () => {
    const runOne = vi.fn(async () => ({ claimed: true }));
    // Each tick advances 10s against a 25s budget: two jobs, then the third
    // check finds the budget spent.
    let clock = 0;
    const now = () => {
      const value = clock;
      clock += 10_000;
      return value;
    };

    const result = await drainQueue(runOne, { maxMs: 25_000, now });

    expect(result.stoppedBecause).toBe('time_budget');
    expect(result.processed).toBeLessThan(5);
  });

  it('checks the time budget before claiming anything', async () => {
    const runOne = vi.fn(async () => ({ claimed: true }));
    let clock = 0;
    const now = () => {
      const value = clock;
      clock += 60_000;
      return value;
    };

    const result = await drainQueue(runOne, { maxMs: 1_000, now });

    expect(result.processed).toBe(0);
    expect(result.stoppedBecause).toBe('time_budget');
    expect(runOne).not.toHaveBeenCalled();
  });

  it('stops on a job failure and reports it, keeping earlier outcomes', async () => {
    let calls = 0;
    const runOne = vi.fn(async () => {
      calls += 1;
      if (calls === 2) {
        throw new Error('extractor exploded');
      }
      return { claimed: true };
    });

    const result = await drainQueue(runOne);

    expect(result.processed).toBe(1);
    expect(result.stoppedBecause).toBe('error');
    expect(result.error).toBe('extractor exploded');
    expect(result.outcomes).toHaveLength(1);
  });

  it('collects each job outcome in order', async () => {
    const runOne = runnerReturning([
      { claimed: true, chapterId: 'a' },
      { claimed: true, chapterId: 'b' },
      { claimed: false },
    ]);

    const result = await drainQueue(runOne);

    expect(result.outcomes).toEqual([
      { claimed: true, chapterId: 'a' },
      { claimed: true, chapterId: 'b' },
    ]);
  });
});
