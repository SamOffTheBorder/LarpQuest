import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Draft persistence against a fake database.
 *
 * The invariant under test: a draft (and its research_jobs rows) is only
 * ever visible through this module to its owner — a non-owner gets the same
 * "not found" a nonexistent draft would produce, matching stories.ts's
 * membership-check-first convention. Re-running a stage preserves the prior
 * output rather than discarding it.
 */

const state = vi.hoisted(() => ({
  drafts: new Map<string, Record<string, unknown>>(),
  jobs: new Map<string, Record<string, unknown>>(), // key: `${draftId}:${stage}`
  sentEvents: [] as { name: string; data: unknown }[],
  nextId: 1,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/inngest/client', () => ({
  inngest: {
    send: async (payload: { name: string; data: unknown }) => {
      state.sentEvents.push(payload);
    },
  },
}));

vi.mock('@/lib/supabase/json', () => ({ toJson: (v: unknown) => v }));

vi.mock('@/lib/supabase/server', () => {
  function draftsTable() {
    const filters: Record<string, unknown> = {};

    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return chain;
      },
      insert(row: Record<string, unknown>) {
        const id = `draft-${state.nextId++}`;
        const created = {
          id,
          owner_id: row.owner_id,
          status: row.status ?? 'researching',
          input: row.input,
          draft: {},
          universe_id: null,
          published_version: null,
          created_at: '2026-08-18T00:00:00Z',
          updated_at: '2026-08-18T00:00:00Z',
        };
        state.drafts.set(id, created);
        return {
          select: () => ({
            async single() {
              return { data: created, error: null };
            },
          }),
        };
      },
      update(patch: Record<string, unknown>) {
        return {
          async eq(column: string, value: unknown) {
            const existing = state.drafts.get(value as string);
            if (existing !== undefined && column === 'id') {
              state.drafts.set(value as string, { ...existing, ...patch });
            }
            return { error: null };
          },
        };
      },
      async maybeSingle() {
        return { data: state.drafts.get(filters.id as string) ?? null, error: null };
      },
    };

    return chain;
  }

  function jobsTable() {
    const filters: Record<string, unknown> = {};

    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return chain;
      },
      order() {
        return chain;
      },
      insert(rows: Record<string, unknown>[]) {
        for (const r of rows) {
          state.jobs.set(`${r.draft_id}:${r.stage}`, {
            draft_id: r.draft_id,
            stage: r.stage,
            status: r.status,
            attempt_count: 0,
            output: null,
            previous_output: null,
            last_error: null,
            updated_at: '2026-08-18T00:00:00Z',
            created_at: '2026-08-18T00:00:00Z',
          });
        }
        return Promise.resolve({ error: null });
      },
      update(patch: Record<string, unknown>) {
        const updateFilters: Record<string, unknown> = { ...filters };
        return {
          eq(column: string, value: unknown) {
            updateFilters[column] = value;
            return this;
          },
          then(resolve: (v: { error: null }) => void) {
            const key = `${updateFilters.draft_id}:${updateFilters.stage}`;
            const existing = state.jobs.get(key);
            if (existing !== undefined) {
              state.jobs.set(key, { ...existing, ...patch });
            }
            resolve({ error: null });
          },
        };
      },
      async maybeSingle() {
        const key = `${filters.draft_id}:${filters.stage}`;
        return { data: state.jobs.get(key) ?? null, error: null };
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        const rows = [...state.jobs.values()].filter((row) => row.draft_id === filters.draft_id);
        resolve({ data: rows, error: null });
      },
    };

    return chain;
  }

  function from(table: string) {
    if (table === 'universe_drafts') return draftsTable();
    if (table === 'research_jobs') return jobsTable();
    throw new Error(`unexpected table ${table}`);
  }

  return {
    createServiceRoleClient: () => ({ from }),
  };
});

const { createDraft, getDraft, listDraftJobs, rerunStage, DraftNotFoundError } = await import(
  '@/lib/research/drafts'
);

beforeEach(() => {
  state.drafts.clear();
  state.jobs.clear();
  state.sentEvents.length = 0;
  state.nextId = 1;
});

describe('createDraft', () => {
  it('seeds all eight research_jobs rows as queued and triggers the pipeline', async () => {
    const draft = await createDraft('user-1', { name: 'Jujutsu Kaisen' });

    expect(draft.ownerId).toBe('user-1');
    expect(draft.status).toBe('researching');

    const jobs = await listDraftJobs(draft.id, 'user-1');
    expect(jobs).toHaveLength(8);
    expect(jobs.every((job) => job.status === 'queued')).toBe(true);

    expect(state.sentEvents).toEqual([{ name: 'research/draft.requested', data: { draftId: draft.id } }]);
  });
});

describe('getDraft', () => {
  it('rejects a non-owner with the same error as a nonexistent draft', async () => {
    const draft = await createDraft('user-1', { name: 'Wovenmere' });

    await expect(getDraft(draft.id, 'user-2')).rejects.toThrow(DraftNotFoundError);
    await expect(getDraft('nonexistent', 'user-1')).rejects.toThrow(DraftNotFoundError);
  });

  it('returns the draft for its owner', async () => {
    const created = await createDraft('user-1', { name: 'Ashfall Legion' });
    const fetched = await getDraft(created.id, 'user-1');
    expect(fetched.id).toBe(created.id);
  });
});

describe('rerunStage', () => {
  it('moves current output to previous_output and resets status to queued', async () => {
    const draft = await createDraft('user-1', { name: 'Jujutsu Kaisen' });

    // Simulate the pipeline having completed the scoping stage.
    state.jobs.set(`${draft.id}:scoping`, {
      ...state.jobs.get(`${draft.id}:scoping`),
      status: 'complete',
      output: { media_type: 'manga' },
    });

    await rerunStage(draft.id, 'user-1', 'scoping');

    const jobs = await listDraftJobs(draft.id, 'user-1');
    const scoping = jobs.find((job) => job.stage === 'scoping');

    expect(scoping?.status).toBe('queued');
    expect(scoping?.previousOutput).toEqual({ media_type: 'manga' });
    expect(scoping?.output).toBeNull();

    expect(state.sentEvents).toContainEqual({
      name: 'research/stage.rerun.requested',
      data: { draftId: draft.id, stage: 'scoping' },
    });
  });

  it('rejects a re-run request from a non-owner', async () => {
    const draft = await createDraft('user-1', { name: 'Jujutsu Kaisen' });
    await expect(rerunStage(draft.id, 'user-2', 'scoping')).rejects.toThrow(DraftNotFoundError);
  });
});
