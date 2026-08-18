import { z } from 'zod';

/**
 * Turn state machine.
 *
 * Transitions are enforced here and nowhere else, so an invalid one such as
 * `published -> generating` cannot happen from a stray call site.
 *
 *   open -> locked -> generating -> published
 *                          |
 *                          v
 *                       failed -> (retry) -> generating
 *
 * `failed` is a first-class state, not an error condition: submissions survive
 * it intact and a retry reuses them verbatim.
 */

export const TURN_STATUSES = ['open', 'locked', 'generating', 'published', 'failed'] as const;

export type TurnStatus = (typeof TURN_STATUSES)[number];

export const turnStatusSchema = z.enum(TURN_STATUSES);

const TRANSITIONS: Record<TurnStatus, readonly TurnStatus[]> = {
  open: ['locked'],
  locked: ['generating'],
  generating: ['published', 'failed'],
  failed: ['generating'],
  published: [],
};

export function canTransition(from: TurnStatus, to: TurnStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTurnTransitionError extends Error {
  constructor(
    readonly from: TurnStatus,
    readonly to: TurnStatus,
  ) {
    const allowed = TRANSITIONS[from];
    const allowedText = allowed.length > 0 ? allowed.join(', ') : 'none — this is a terminal state';

    super(`Invalid turn transition ${from} -> ${to}. Allowed from ${from}: ${allowedText}.`);
    this.name = 'InvalidTurnTransitionError';
  }
}

/**
 * Assert a transition is legal. Throws rather than returning a boolean so that
 * callers cannot accidentally ignore the result.
 */
export function assertTransition(from: TurnStatus, to: TurnStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTurnTransitionError(from, to);
  }
}

/** Submissions may only be created or edited while the turn is open. */
export function acceptsSubmissions(status: TurnStatus): boolean {
  return status === 'open';
}

/** A story may not open a new turn while one is still live. */
export function isLive(status: TurnStatus): boolean {
  return status !== 'published';
}

export function isRetryable(status: TurnStatus): boolean {
  return status === 'failed';
}
