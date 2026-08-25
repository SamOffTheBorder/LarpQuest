import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  inserted: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

vi.mock('node:fs/promises', () => ({
  readFile: async (filePath: string) => {
    const content = state.files.get(filePath);
    if (content === undefined) {
      throw new Error(`ENOENT: ${filePath}`);
    }
    return content;
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: async (rows: Record<string, unknown>[]) => {
        if (table === 'legal_acceptances') {
          state.inserted.push(...rows);
          return { error: null };
        }
        return { error: null };
      },
    }),
  }),
}));

const { renderLegalDocument, recordLegalAcceptance, versionOf } = await import('@/lib/legal');

const path = await import('node:path');

function pathFor(filename: string): string {
  return path.join(process.cwd(), '..', '..', 'legal', filename);
}

beforeEach(() => {
  state.files.clear();
  state.inserted.length = 0;

  state.files.set(pathFor('TERMS_OF_SERVICE.md'), '# Terms\n\nContent A.');
  state.files.set(pathFor('PRIVACY_POLICY.md'), '# Privacy\n\nContent B.');
  state.files.set(pathFor('ACCEPTABLE_USE.md'), '# Acceptable Use\n\nContent C.');
});

describe('renderLegalDocument', () => {
  it('renders markdown to HTML', async () => {
    const { html } = await renderLegalDocument('terms');
    expect(html).toContain('<h1>Terms</h1>');
    expect(html).toContain('Content A.');
  });

  it('rewrites cross-document markdown links to in-app routes', async () => {
    state.files.set(
      pathFor('TERMS_OF_SERVICE.md'),
      '# Terms\n\nSee the [Privacy Policy](./PRIVACY_POLICY.md) and [Acceptable Use Policy](./ACCEPTABLE_USE.md).',
    );

    const { html } = await renderLegalDocument('terms');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/acceptable-use"');
    expect(html).not.toContain('.md');
  });

  it('version changes when content changes', async () => {
    const first = await renderLegalDocument('terms');

    state.files.set(pathFor('TERMS_OF_SERVICE.md'), '# Terms\n\nContent A, revised.');
    const second = await renderLegalDocument('terms');

    expect(second.version).not.toBe(first.version);
  });

  it('version is stable for identical content', async () => {
    const first = await renderLegalDocument('privacy');
    const second = await renderLegalDocument('privacy');

    expect(second.version).toBe(first.version);
  });
});

describe('versionOf', () => {
  it('is a short deterministic hash', () => {
    const a = versionOf('hello');
    const b = versionOf('hello');
    const c = versionOf('world');

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(12);
  });
});

describe('recordLegalAcceptance', () => {
  it('records one row per document for the given email', async () => {
    await recordLegalAcceptance('player@example.com');

    expect(state.inserted).toHaveLength(3);
    expect(state.inserted.map((row) => row.document).sort()).toEqual([
      'acceptable_use',
      'privacy',
      'terms',
    ]);
    expect(state.inserted.every((row) => row.email === 'player@example.com')).toBe(true);
    expect(state.inserted.every((row) => typeof row.version === 'string' && (row.version as string).length === 12)).toBe(
      true,
    );
  });
});
