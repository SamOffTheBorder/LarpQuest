import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural guard mirroring lib/engine/genre-agnosticism.test.ts, scoped to
 * retrieval.ts (context-assembly spec's "Retrieval respects universe-supplied
 * bias without branching on it"): the same ranking function must run
 * unmodified for every universe, with no conditional keyed on
 * retrieval_bias, genre, universe name, or media type. retrieval_bias is
 * allowed to shape summary *content* upstream (memory/prompts.ts) — that file
 * is intentionally excluded, since branching on the bias value there is the
 * documented design (design.md decision 4), not a violation.
 */

const MEMORY_DIR = join(__dirname);

const FORBIDDEN_PATTERNS: RegExp[] = [
  /ashfall/i,
  /wovenmere/i,
  /\bjujutsu\b/i,
  /media_type\s*===/,
  /genre_tags?\s*===/,
  /universe\.(slug|name)\s*===/,
  /retrieval_?bias\s*===/i,
  /retrievalBias\s*===/,
];

describe('retrieval.ts stays universe-agnostic', () => {
  it('contains no branch on retrieval_bias, genre, or a specific fixture universe', () => {
    const contents = readFileSync(join(MEMORY_DIR, 'retrieval.ts'), 'utf8');
    const offenders = FORBIDDEN_PATTERNS.filter((pattern) => pattern.test(contents));

    expect(offenders).toEqual([]);
  });

  it('ranking uses one similarity path for every match, not a per-bias branch', () => {
    const contents = readFileSync(join(MEMORY_DIR, 'retrieval.ts'), 'utf8');

    // The only sort/rank call in the file — asserting there is exactly one
    // guards against someone adding a second, bias-specific ranking path
    // later without touching this test.
    const sortCalls = contents.match(/\.sort\(/g) ?? [];
    expect(sortCalls).toHaveLength(1);
  });
});
