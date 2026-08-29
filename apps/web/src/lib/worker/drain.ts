import 'server-only';

/**
 * Shared drain loop for the single-row queue workers.
 *
 * `runOneExtraction` and `runOneMemoryJob` each claim and process exactly one
 * queue row, returning `{ claimed: false }` when the queue is empty. That is
 * the right unit of work — a claim is atomic and a failure isolates to one
 * row — but it means a scheduler invoking the route once drains one row per
 * invocation. On a cron that fires daily, an active story's queue never
 * catches up: state extraction and chapter summaries fall a day behind every
 * chapter published, so the next turn is assembled from stale entity state.
 *
 * This loops the single-row runner until the queue is empty, a job budget is
 * reached, or a wall-clock budget is reached. The clock budget exists because
 * the routes run in a serverless function with a hard execution ceiling: we
 * would rather return a partial drain with a 200 than be killed mid-job and
 * leave a row `claimed` for stale-claim recovery.
 *
 * A job that throws stops the drain rather than being swallowed. The runner
 * has already recorded the failure on its own queue row before rethrowing, so
 * stopping surrenders only the remaining rows — which the next invocation
 * picks up — while continuing past an error risks burning the whole budget
 * looping over the same systemic failure (a bad key, a dead provider).
 */

/** Default cap on jobs per invocation. */
export const DEFAULT_MAX_JOBS = 25;

/**
 * Default wall-clock budget, comfortably inside Vercel's default serverless
 * execution ceiling with room for the final job to finish.
 */
export const DEFAULT_MAX_MS = 45_000;

export interface DrainOptions {
  maxJobs?: number;
  maxMs?: number;
  /** Injectable clock, so tests do not depend on real elapsed time. */
  now?: () => number;
}

export interface DrainResult<T> {
  /** How many jobs were claimed and processed successfully. */
  processed: number;
  /** Why the loop stopped. */
  stoppedBecause: 'empty' | 'max_jobs' | 'time_budget' | 'error';
  /** Per-job outcomes, in the order they were processed. */
  outcomes: T[];
  /** Message from the job that stopped the drain, when one did. */
  error?: string;
}

/**
 * Repeatedly invoke a single-row runner until it reports an empty queue.
 *
 * The runner must return an object with a `claimed` flag — `false` meaning
 * the queue held nothing to claim.
 */
export async function drainQueue<T extends { claimed: boolean }>(
  runOne: () => Promise<T>,
  options: DrainOptions = {},
): Promise<DrainResult<T>> {
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const now = options.now ?? Date.now;

  const startedAt = now();
  const outcomes: T[] = [];

  while (outcomes.length < maxJobs) {
    if (now() - startedAt >= maxMs) {
      return { processed: outcomes.length, stoppedBecause: 'time_budget', outcomes };
    }

    let outcome: T;
    try {
      outcome = await runOne();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return {
        processed: outcomes.length,
        stoppedBecause: 'error',
        outcomes,
        error: message.slice(0, 2000),
      };
    }

    if (!outcome.claimed) {
      return { processed: outcomes.length, stoppedBecause: 'empty', outcomes };
    }

    outcomes.push(outcome);
  }

  return { processed: outcomes.length, stoppedBecause: 'max_jobs', outcomes };
}
