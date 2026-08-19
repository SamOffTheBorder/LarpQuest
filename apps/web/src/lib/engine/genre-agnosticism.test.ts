import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural guard for CLAUDE.md's non-negotiable constraint #1: no
 * conditional on genre, universe, or media type in engine code, ever.
 *
 * This scans every non-test file in lib/engine for the specific fixture
 * identifiers and genre vocabulary that a special case would have to
 * reference. It is deliberately narrow — a false negative here just means a
 * violation slips through, which the fixtures in test-universes.test.ts
 * (running two structurally incompatible universes through identical code)
 * are the real backstop for. This test exists to catch the obvious case
 * cheaply and fail fast in review.
 */

const ENGINE_DIR = join(__dirname);

const FORBIDDEN_PATTERNS: RegExp[] = [
  /ashfall/i,
  /wovenmere/i,
  /\bjujutsu\b/i,
  /power_system_type/i,
  /media_type\s*===/,
  /genre_tags?\s*===/,
  /universe\.(slug|name)\s*===/,
];

// test-universes.ts is fixture *content* (never imported by the engine
// itself — see its own doc comment), not engine code. It is expected and
// correct for it to name specific universes; that is the thing being scanned
// for everywhere else.
const EXCLUDED = new Set(['test-universes.ts']);

/**
 * Recurses one level into subdirectories (e.g. `rules/`) so newly added
 * modules like the Standard Rule Pack are covered without needing this test
 * updated for every future subfolder — non-.ts entries and further nesting
 * are simply skipped rather than erroring.
 */
function engineSourceFiles(): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(ENGINE_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const nested of readdirSync(join(ENGINE_DIR, entry.name))) {
        if (nested.endsWith('.ts') && !nested.endsWith('.test.ts')) {
          files.push(join(ENGINE_DIR, entry.name, nested));
        }
      }
      continue;
    }

    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !EXCLUDED.has(entry.name)) {
      files.push(join(ENGINE_DIR, entry.name));
    }
  }

  return files;
}

describe('engine code stays genre-agnostic', () => {
  it('contains no reference to a specific fixture universe or genre-keyed branch', () => {
    const offenders: string[] = [];

    for (const filePath of engineSourceFiles()) {
      const contents = readFileSync(filePath, 'utf8');

      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(contents)) {
          offenders.push(`${filePath}: matched ${pattern}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('progression-models.ts and schema.ts dispatch only on the bounded primitive/model vocabulary', () => {
    const progressionSource = readFileSync(join(ENGINE_DIR, 'progression-models.ts'), 'utf8');
    const schemaSource = readFileSync(join(ENGINE_DIR, 'schema.ts'), 'utf8');

    // The only `switch`/dispatch keys allowed are the field type primitives
    // and the two registered progression model slugs — never a universe name.
    for (const forbidden of ['ashfall', 'wovenmere', 'jujutsu']) {
      expect(progressionSource.toLowerCase()).not.toContain(forbidden);
      expect(schemaSource.toLowerCase()).not.toContain(forbidden);
    }
  });
});
