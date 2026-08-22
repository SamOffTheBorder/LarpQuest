import { describe, expect, it } from 'vitest';

import { soleOwnedStoryIds } from './sole-ownership';

describe('soleOwnedStoryIds', () => {
  it('flags a story where the user is the only owner', () => {
    const result = soleOwnedStoryIds('u1', [{ storyId: 's1', userId: 'u1' }]);
    expect(result).toEqual(['s1']);
  });

  it('does not flag a story with a co-owner', () => {
    const result = soleOwnedStoryIds('u1', [
      { storyId: 's1', userId: 'u1' },
      { storyId: 's1', userId: 'u2' },
    ]);
    expect(result).toEqual([]);
  });

  it('handles a mix of sole- and co-owned stories independently', () => {
    const result = soleOwnedStoryIds('u1', [
      { storyId: 'sole', userId: 'u1' },
      { storyId: 'shared', userId: 'u1' },
      { storyId: 'shared', userId: 'u2' },
    ]);
    expect(result).toEqual(['sole']);
  });

  it('returns nothing when the user owns no stories', () => {
    expect(soleOwnedStoryIds('u1', [])).toEqual([]);
  });

  it('does not flag a story where the user is not among the owners at all', () => {
    // Should not happen given how the caller builds candidateStoryIds, but the
    // pure function should not assume its input is well-formed.
    const result = soleOwnedStoryIds('u1', [{ storyId: 's1', userId: 'u2' }]);
    expect(result).toEqual([]);
  });
});
