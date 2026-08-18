import { describe, expect, it } from 'vitest';

import {
  acceptsSubmissions,
  assertTransition,
  canTransition,
  InvalidTurnTransitionError,
  isLive,
  isRetryable,
  TURN_STATUSES,
  type TurnStatus,
} from './turn-state';

describe('turn state machine', () => {
  it('permits the documented happy path', () => {
    expect(canTransition('open', 'locked')).toBe(true);
    expect(canTransition('locked', 'generating')).toBe(true);
    expect(canTransition('generating', 'published')).toBe(true);
  });

  it('permits failure and retry', () => {
    expect(canTransition('generating', 'failed')).toBe(true);
    expect(canTransition('failed', 'generating')).toBe(true);
  });

  it('rejects transitions out of the terminal published state', () => {
    for (const status of TURN_STATUSES) {
      expect(canTransition('published', status)).toBe(false);
    }
  });

  it('rejects skipping the lock step', () => {
    expect(canTransition('open', 'generating')).toBe(false);
    expect(canTransition('open', 'published')).toBe(false);
  });

  it('throws a descriptive error naming the allowed transitions', () => {
    expect(() => {
      assertTransition('published', 'generating');
    }).toThrow(InvalidTurnTransitionError);

    expect(() => {
      assertTransition('open', 'published');
    }).toThrow(/Allowed from open: locked/);
  });

  it('accepts submissions only while open', () => {
    const accepting = TURN_STATUSES.filter((status: TurnStatus) => acceptsSubmissions(status));
    expect(accepting).toEqual(['open']);
  });

  it('treats every non-published status as live', () => {
    // A story may not open a new turn while one is live.
    expect(isLive('open')).toBe(true);
    expect(isLive('failed')).toBe(true);
    expect(isLive('published')).toBe(false);
  });

  it('marks only failed turns retryable', () => {
    const retryable = TURN_STATUSES.filter((status: TurnStatus) => isRetryable(status));
    expect(retryable).toEqual(['failed']);
  });
});
