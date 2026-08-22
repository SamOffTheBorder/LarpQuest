/**
 * Spend cap policy (build plan Part 8.3).
 *
 * Deliberately free of I/O so the decision itself is testable without a
 * database. `lib/ai/spend.ts` supplies the numbers; the gateway enforces the
 * verdict. Nothing here knows about genre, universe, or turn mode — a cap is a
 * cap.
 */

/** Applies when neither the story nor the user sets one of their own. */
export const DEFAULT_STORY_CAP_USD = 25;
export const DEFAULT_USER_CAP_USD = 50;

export type CapScope = 'story' | 'user';

export interface SpendSnapshot {
  storySpendUsd: number;
  userSpendUsd: number;
  /** Null means the story sets no cap of its own; the default then applies. */
  storyCapUsd: number | null;
  userCapUsd: number | null;
}

export interface BudgetVerdict {
  allowed: boolean;
  /** Set only when `allowed` is false. */
  exceeded?: CapScope;
  spentUsd?: number;
  capUsd?: number;
}

/**
 * Decide whether another model call may proceed.
 *
 * A cap is checked against spend *already recorded*, so a call is refused only
 * once the cap has actually been reached — the call that crosses it is allowed
 * to finish. Refusing earlier would require estimating the cost of a call
 * before making it, which is guesswork the provider does not support.
 *
 * A cap of 0 is meaningful and stops everything; only null falls back to the
 * default.
 */
export function checkBudget(snapshot: SpendSnapshot): BudgetVerdict {
  const storyCap = snapshot.storyCapUsd ?? DEFAULT_STORY_CAP_USD;
  const userCap = snapshot.userCapUsd ?? DEFAULT_USER_CAP_USD;

  // Story first: it is the narrower, more commonly configured limit, and it
  // produces the more actionable message for a room that has run out.
  if (snapshot.storySpendUsd >= storyCap) {
    return {
      allowed: false,
      exceeded: 'story',
      spentUsd: snapshot.storySpendUsd,
      capUsd: storyCap,
    };
  }

  if (snapshot.userSpendUsd >= userCap) {
    return {
      allowed: false,
      exceeded: 'user',
      spentUsd: snapshot.userSpendUsd,
      capUsd: userCap,
    };
  }

  return { allowed: true };
}

/**
 * Raised by the gateway when a call is refused. A distinct type so callers can
 * surface a spend message rather than a generic provider failure — running out
 * of budget is a state the user can act on, not a bug.
 */
export class SpendCapExceededError extends Error {
  constructor(
    readonly scope: CapScope,
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(
      scope === 'story'
        ? `This story has reached its spend cap ($${capUsd.toFixed(2)}). ` +
          `Raise the cap in story settings to continue.`
        : `You have reached your account spend cap ($${capUsd.toFixed(2)}). ` +
          `Raise it in your settings to continue.`,
    );
    this.name = 'SpendCapExceededError';
  }
}
