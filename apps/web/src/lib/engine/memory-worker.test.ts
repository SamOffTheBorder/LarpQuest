import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The invariant under test: the memory worker runs strictly after
 * publication and never touches `extraction_status`/`extracted_diffs` (a
 * separate failure domain) or publication fields. A failure leaves the
 * chapter readable, only `memory_status` changes. An arc boundary crossing
 * triggers `generateArcSummary`; a non-boundary chapter does not.
 */

const state = vi.hoisted(() => ({
  queue: new Map<string, Record<string, unknown>>(),
  chapters: new Map<string, Record<string, unknown>>(),
  stories: new Map<string, Record<string, unknown>>(),
  universeVersions: new Map<string, Record<string, unknown>>(),
  entities: [] as Record<string, unknown>[],
  chapterWrites: [] as Record<string, unknown>[],
  arcSummaryInserts: [] as Record<string, unknown>[],
  summarizerBehavior: 'succeed' as 'succeed' | 'throw',
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ OPENROUTER_API_KEY: 'test-key', WORKER_SECRET: 'test-secret' }),
  clientEnv: {},
}));

vi.mock('@/lib/ai/usage', () => ({
  createUsageRecorder: () => ({ record: async () => {} }),
}));

vi.mock('@/lib/ai/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/gateway')>('@/lib/ai/gateway');

  return {
    ...actual,
    callStructured: async (
      deps: { usage: { record: (entry: unknown) => Promise<void> } },
      args: { role: string },
    ) => {
      if (state.summarizerBehavior === 'throw') {
        await deps.usage.record({ role: args.role, succeeded: false });
        throw new Error('summarizer call failed');
      }

      await deps.usage.record({ role: args.role, succeeded: true });

      if (args.role === 'summarizer') {
        return {
          data: { what_happened: 'x', who_was_involved: [], what_changed: [] },
          resolvedModel: 'm',
          usedFallbackModel: false,
        };
      }

      // Arc summary path reuses callStructured too, distinguished by schema
      // shape rather than role - return the arc shape when asked for it via
      // its distinct prompt marker isn't available here, so key off call
      // order isn't reliable either; instead both memory.generate and
      // arc-compaction pass role: 'summarizer', so return a shape that
      // satisfies both schemas (arc schema only needs `summary`).
      return { data: { summary: 'arc summary text' }, resolvedModel: 'm', usedFallbackModel: false };
    },
    embedText: async () => ({ embedding: [0.1, 0.2], resolvedModel: 'm', usedFallbackModel: false }),
  };
});

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        builder._filters[column] = value;
        return builder;
      },
      gte() {
        return builder;
      },
      lte() {
        return builder;
      },
      order() {
        return builder;
      },
      update(values: Record<string, unknown>) {
        if (table === 'chapters') {
          state.chapterWrites.push(values);
        }

        const updateBuilder = {
          _eq: {} as Record<string, unknown>,
          eq(column: string, value: unknown) {
            updateBuilder._eq[column] = value;
            return updateBuilder;
          },
          then(resolve: (v: { error: null }) => void) {
            const id = updateBuilder._eq.id as string;
            const store = table === 'chapters' ? state.chapters : state.queue;
            const existing = store.get(id);

            if (existing !== undefined) {
              store.set(id, { ...existing, ...values });
            }

            resolve({ error: null });
          },
        };

        return updateBuilder;
      },
      insert: async (values: Record<string, unknown>) => {
        if (table === 'arc_summaries') {
          state.arcSummaryInserts.push(values);
        }
        return { error: null };
      },
      async single() {
        if (table === 'chapters') {
          return { data: state.chapters.get(builder._filters.id as string), error: null };
        }

        if (table === 'stories') {
          return { data: state.stories.get(builder._filters.id as string), error: null };
        }

        if (table === 'universe_versions') {
          return { data: state.universeVersions.get(builder._filters.universe_id as string) ?? null, error: null };
        }

        return { data: null, error: null };
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        if (table === 'entities') {
          resolve({ data: state.entities, error: null });
          return;
        }

        if (table === 'chapters') {
          const rows = [...state.chapters.values()].filter(
            (row) => row.story_id === builder._filters.story_id,
          );
          resolve({ data: rows, error: null });
          return;
        }

        resolve({ data: [], error: null });
      },
    };

    return builder;
  }

  return {
    createServiceRoleClient: () => ({
      from,
      async rpc(name: string) {
        if (name === 'claim_memory_job') {
          const job = [...state.queue.values()].find((row) => row.status === 'queued');
          if (job === undefined) {
            return { data: null, error: null };
          }
          state.queue.set(job.id as string, { ...job, status: 'claimed' });
          return { data: job, error: null };
        }

        return { data: null, error: null };
      },
    }),
    createClient: async () => ({}),
  };
});

const CHAPTER = 'chapter-1';
const STORY = 'story-1';
const JOB = 'job-1';

beforeEach(() => {
  state.queue.clear();
  state.chapters.clear();
  state.stories.clear();
  state.universeVersions.clear();
  state.entities = [];
  state.chapterWrites.length = 0;
  state.arcSummaryInserts.length = 0;
  state.summarizerBehavior = 'succeed';

  state.chapters.set(CHAPTER, {
    id: CHAPTER,
    story_id: STORY,
    turn_number: 3,
    prose: 'They walked to the harbor.',
    summary: null,
    extraction_status: 'pending',
    extracted_diffs: null,
    published_at: '2026-08-13T00:00:00Z',
  });

  state.stories.set(STORY, {
    id: STORY,
    model_config: null,
    current_turn: 3,
    universe_id: null,
    universe_version: null,
  });

  state.queue.set(JOB, { id: JOB, chapter_id: CHAPTER, story_id: STORY, status: 'queued' });
});

describe('memory worker', () => {
  it('generates memory and marks the chapter memory-complete on success', async () => {
    const { runOneMemoryJob } = await import('@/lib/engine/memory-worker');

    const outcome = await runOneMemoryJob();

    expect(outcome.claimed).toBe(true);
    expect(outcome.memoryStatus).toBe('complete');
    expect(state.chapters.get(CHAPTER)?.memory_status).toBe('complete');
    expect(state.chapters.get(CHAPTER)?.summary).toBeTruthy();
    expect(state.chapters.get(CHAPTER)?.embedding).toBe('[0.1,0.2]');
  });

  it('never touches extraction_status, extracted_diffs, or publication fields', async () => {
    const { runOneMemoryJob } = await import('@/lib/engine/memory-worker');

    await runOneMemoryJob();

    for (const write of state.chapterWrites) {
      expect(write.extraction_status).toBeUndefined();
      expect(write.extracted_diffs).toBeUndefined();
      expect(write.prose).toBeUndefined();
      expect(write.published_at).toBeUndefined();
    }

    const chapter = state.chapters.get(CHAPTER);
    expect(chapter?.extraction_status).toBe('pending');
    expect(chapter?.prose).toBe('They walked to the harbor.');
  });

  it('marks the chapter memory-failed and the queue row failed when the summarizer call fails, without touching publication state', async () => {
    state.summarizerBehavior = 'throw';
    const { runOneMemoryJob } = await import('@/lib/engine/memory-worker');

    await runOneMemoryJob();

    expect(state.chapters.get(CHAPTER)?.memory_status).toBe('failed');
    expect(state.chapters.get(CHAPTER)?.prose).toBe('They walked to the harbor.');
    expect(state.chapters.get(CHAPTER)?.published_at).toBe('2026-08-13T00:00:00Z');
    expect(state.queue.get(JOB)?.status).toBe('failed');
  });

  it('does not compact an arc when the story has not crossed a boundary', async () => {
    state.stories.set(STORY, { ...state.stories.get(STORY), current_turn: 3 });
    const { runOneMemoryJob } = await import('@/lib/engine/memory-worker');

    const outcome = await runOneMemoryJob();

    expect(outcome.arcCompacted).toBe(false);
    expect(state.arcSummaryInserts).toHaveLength(0);
  });

  it('compacts an arc and writes an arc_summaries row when the story crosses an arc boundary', async () => {
    // ARC_COMPACTION_THRESHOLD_CHAPTERS=50, ARC_SIZE_CHAPTERS=12 -> first close at chapter 61.
    state.stories.set(STORY, { ...state.stories.get(STORY), current_turn: 61 });
    state.chapters.set(CHAPTER, { ...state.chapters.get(CHAPTER), turn_number: 61 });

    const { runOneMemoryJob } = await import('@/lib/engine/memory-worker');

    const outcome = await runOneMemoryJob();

    expect(outcome.arcCompacted).toBe(true);
    expect(state.arcSummaryInserts).toHaveLength(1);
    expect(state.arcSummaryInserts[0]).toMatchObject({ from_chapter: 50, to_chapter: 61 });
  });

  it('reports an empty queue rather than throwing', async () => {
    state.queue.clear();
    const { runOneMemoryJob } = await import('@/lib/engine/memory-worker');

    const outcome = await runOneMemoryJob();

    expect(outcome.claimed).toBe(false);
  });
});
