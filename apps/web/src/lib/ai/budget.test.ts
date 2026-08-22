import { describe, expect, it } from 'vitest';

import {
  checkBudget,
  DEFAULT_STORY_CAP_USD,
  DEFAULT_USER_CAP_USD,
  SpendCapExceededError,
  type SpendSnapshot,
} from './budget';

function snapshot(overrides: Partial<SpendSnapshot> = {}): SpendSnapshot {
  return {
    storySpendUsd: 0,
    userSpendUsd: 0,
    storyCapUsd: null,
    userCapUsd: null,
    ...overrides,
  };
}

describe('checkBudget', () => {
  it('allows a call well under both caps', () => {
    expect(checkBudget(snapshot({ storySpendUsd: 1, userSpendUsd: 2 })).allowed).toBe(true);
  });

  it('refuses once story spend reaches the story cap', () => {
    const verdict = checkBudget(snapshot({ storySpendUsd: 10, storyCapUsd: 10 }));

    expect(verdict.allowed).toBe(false);
    expect(verdict.exceeded).toBe('story');
    expect(verdict.capUsd).toBe(10);
  });

  it('refuses once user spend reaches the user cap', () => {
    const verdict = checkBudget(snapshot({ userSpendUsd: 7.5, userCapUsd: 7.5 }));

    expect(verdict.allowed).toBe(false);
    expect(verdict.exceeded).toBe('user');
  });

  it('allows the call that crosses the cap, refusing only the next one', () => {
    // Cost is knowable only after a call returns, so the cap is enforced
    // against spend already recorded. A story at 9.99 of a 10 cap may still
    // make one more call; the one after it is refused.
    expect(checkBudget(snapshot({ storySpendUsd: 9.99, storyCapUsd: 10 })).allowed).toBe(true);
    expect(checkBudget(snapshot({ storySpendUsd: 10.4, storyCapUsd: 10 })).allowed).toBe(false);
  });

  it('falls back to the defaults when no cap is set', () => {
    expect(checkBudget(snapshot({ storySpendUsd: DEFAULT_STORY_CAP_USD })).allowed).toBe(false);
    expect(
      checkBudget(snapshot({ userSpendUsd: DEFAULT_USER_CAP_USD, storyCapUsd: Infinity })).allowed,
    ).toBe(false);
  });

  it('treats a zero cap as a stop, not as unset', () => {
    // The distinction that matters: 0 means "spend nothing", null means
    // "no opinion, use the default".
    const verdict = checkBudget(snapshot({ storySpendUsd: 0, storyCapUsd: 0 }));

    expect(verdict.allowed).toBe(false);
    expect(verdict.capUsd).toBe(0);
  });

  it('reports the story cap first when both are exceeded', () => {
    const verdict = checkBudget(
      snapshot({ storySpendUsd: 100, storyCapUsd: 10, userSpendUsd: 100, userCapUsd: 10 }),
    );

    expect(verdict.exceeded).toBe('story');
  });
});

describe('SpendCapExceededError', () => {
  it('names the scope that was exceeded and where to raise it', () => {
    const storyError = new SpendCapExceededError('story', 12, 10);
    expect(storyError.scope).toBe('story');
    expect(storyError.message).toContain('story settings');

    const userError = new SpendCapExceededError('user', 60, 50);
    expect(userError.message).toContain('your settings');
  });
});
