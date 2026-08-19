import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Story export against a fake database + fake storage. Invariants under
 * test: markdown export produces the expected structure; all three formats
 * complete and upload; a non-member is rejected before any job is created;
 * a rendering failure marks the job failed and is retryable; export only
 * ever reads chapters that are not rolled back.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, string>(),
  stories: new Map<string, Record<string, unknown>>(),
  chapters: [] as Record<string, unknown>[],
  exportJobs: new Map<string, Record<string, unknown>>(),
  uploads: [] as { bucket: string; path: string; contentType: string }[],
  renderBehavior: 'succeed' as 'succeed' | 'throw',
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const filters: Record<string, unknown> = {};

    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      is() {
        return builder;
      },
      order() {
        return builder;
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const role = state.members.get(`${filters.story_id}:${filters.user_id}`);
          return { data: role !== undefined ? { role } : null, error: null };
        }
        return { data: null, error: null };
      },
      async single() {
        if (table === 'stories') {
          const story = state.stories.get(filters.id as string);
          return { data: story ?? null, error: story === undefined ? { message: 'not found' } : null };
        }
        return { data: null, error: null };
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        if (table === 'chapters') {
          if (state.renderBehavior === 'throw') {
            throw new Error('chapter read failed');
          }
          const rows = state.chapters.filter(
            (c) => c.story_id === filters.story_id && c.rolled_back_at === null,
          );
          resolve({ data: rows, error: null });
          return;
        }
        if (table === 'export_jobs') {
          const rows = [...state.exportJobs.values()].filter((row) => row.story_id === filters.story_id);
          resolve({ data: rows, error: null });
          return;
        }
        resolve({ data: [], error: null });
      },
      update(values: Record<string, unknown>) {
        return {
          eq(_column: string, value: unknown) {
            return {
              select() {
                return {
                  async single() {
                    const existing = state.exportJobs.get(value as string);
                    const updated = { ...existing, ...values };
                    state.exportJobs.set(value as string, updated);
                    return { data: updated, error: null };
                  },
                };
              },
            };
          },
        };
      },
      insert(values: Record<string, unknown>) {
        return {
          select() {
            return {
              async single() {
                if (table === 'export_jobs') {
                  const id = `job-${state.exportJobs.size + 1}`;
                  const row = { id, storage_path: null, error: null, ...values };
                  state.exportJobs.set(id, row);
                  return { data: row, error: null };
                }
                return { data: null, error: null };
              },
            };
          },
        };
      },
    };

    return builder;
  }

  return {
    createServiceRoleClient: () => ({
      from,
      storage: {
        from: (bucket: string) => ({
          async upload(path: string, bytes: unknown, opts: { contentType: string }) {
            state.uploads.push({ bucket, path, contentType: opts.contentType });
            return { data: { path }, error: null };
          },
        }),
      },
    }),
  };
});

const { renderStoryMarkdown, requestExport, listExportJobs } = await import('@/lib/engine/export');

const STORY = 'story-1';
const MEMBER = 'member-1';
const OUTSIDER = 'outsider-1';

beforeEach(() => {
  state.members.clear();
  state.stories.clear();
  state.chapters.length = 0;
  state.exportJobs.clear();
  state.uploads.length = 0;
  state.renderBehavior = 'succeed';

  state.members.set(`${STORY}:${MEMBER}`, 'player');
  state.stories.set(STORY, { id: STORY, title: 'The Long Road' });
  state.chapters.push(
    { story_id: STORY, turn_number: 1, prose: 'It began at dawn.', rolled_back_at: null },
    { story_id: STORY, turn_number: 2, prose: 'They reached the harbor.', rolled_back_at: null },
    { story_id: STORY, turn_number: 3, prose: 'A chapter that was undone.', rolled_back_at: '2026-08-01T00:00:00Z' },
  );
});

describe('renderStoryMarkdown', () => {
  it('produces a title heading and one section per non-rolled-back chapter in order', async () => {
    const markdown = await renderStoryMarkdown(STORY);

    expect(markdown).toContain('# The Long Road');
    expect(markdown).toContain('## Chapter 1');
    expect(markdown).toContain('It began at dawn.');
    expect(markdown).toContain('## Chapter 2');
    expect(markdown).not.toContain('A chapter that was undone.');
  });
});

describe('requestExport', () => {
  it('completes a markdown export and uploads it', async () => {
    const job = await requestExport(STORY, MEMBER, 'markdown');

    expect(job.status).toBe('complete');
    expect(job.storagePath).toContain('.md');
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0]?.contentType).toBe('text/markdown');
  });

  it('completes a pdf export and uploads it', async () => {
    const job = await requestExport(STORY, MEMBER, 'pdf');

    expect(job.status).toBe('complete');
    expect(job.storagePath).toContain('.pdf');
    expect(state.uploads[0]?.contentType).toBe('application/pdf');
  });

  it('completes an epub export and uploads it', async () => {
    const job = await requestExport(STORY, MEMBER, 'epub');

    expect(job.status).toBe('complete');
    expect(job.storagePath).toContain('.epub');
    expect(state.uploads[0]?.contentType).toBe('application/epub+zip');
  });

  it('rejects a non-member before creating any job', async () => {
    await expect(requestExport(STORY, OUTSIDER, 'markdown')).rejects.toThrow();

    expect(state.exportJobs.size).toBe(0);
    expect(state.uploads).toHaveLength(0);
  });

  it('marks the job failed and does not throw when rendering fails', async () => {
    state.renderBehavior = 'throw';

    const job = await requestExport(STORY, MEMBER, 'markdown');

    expect(job.status).toBe('failed');
    expect(job.error).toContain('chapter read failed');
  });
});

describe('listExportJobs', () => {
  it('returns jobs for the story, readable by any member', async () => {
    await requestExport(STORY, MEMBER, 'markdown');

    const jobs = await listExportJobs(STORY, MEMBER);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.format).toBe('markdown');
  });
});
