import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The invariant under test: extraction runs strictly after publication and
 * can never block, delay, or reverse it. A chapter's prose, published_at, and
 * turn_id must be untouched by every code path in the worker, success or
 * failure — the only field extraction is allowed to change is
 * extraction_status (and extracted_diffs on success).
 */

const state = vi.hoisted(() => ({
  queue: new Map<string, Record<string, unknown>>(),
  chapters: new Map<string, Record<string, unknown>>(),
  entities: new Map<string, Record<string, unknown>>(),
  /** Every write to `chapters`, so a test can assert publication fields are untouched. */
  chapterWrites: [] as Record<string, unknown>[],
  extractorBehavior: 'succeed' as 'succeed' | 'throw' | 'malformed',
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
    callStructured: async () => {
      if (state.extractorBehavior === 'throw') {
        throw new Error('extractor call failed');
      }

      if (state.extractorBehavior === 'malformed') {
        throw new actual.StructuredOutputError('extractor', 2, 'not json', new Error('bad'));
      }

      return {
        data: {
          diffs: [
            {
              entity_id: 'entity-1',
              field: 'location',
              from: null,
              to: 'harbor',
              evidence: 'walked to the harbor',
            },
          ],
        },
        resolvedModel: 'm',
        usedFallbackModel: false,
      };
    },
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
      async single() {
        if (table === 'chapters') {
          return { data: state.chapters.get(builder._filters.id as string), error: null };
        }

        if (table === 'stories') {
          return { data: { model_config: null }, error: null };
        }

        return { data: null, error: null };
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        if (table === 'entities') {
          resolve({ data: [...state.entities.values()], error: null });
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
      async rpc(name: string, args: Record<string, unknown>) {
        if (name === 'claim_extraction_job') {
          const job = [...state.queue.values()].find((row) => row.status === 'queued');
          if (job === undefined) {
            return { data: null, error: null };
          }
          state.queue.set(job.id as string, { ...job, status: 'claimed' });
          return { data: job, error: null };
        }

        if (name === 'apply_entity_update') {
          const id = args.p_entity_id as string;
          const existing = state.entities.get(id);
          if (existing !== undefined) {
            state.entities.set(id, { ...existing, data: args.p_data });
          }
          return { data: existing, error: null };
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
  state.entities.clear();
  state.chapterWrites.length = 0;
  state.extractorBehavior = 'succeed';

  state.chapters.set(CHAPTER, {
    id: CHAPTER,
    story_id: STORY,
    prose: 'They walked to the harbor.',
    turn_mode: 'freeform',
    published_at: '2026-08-13T00:00:00Z',
    turn_id: 'turn-1',
    extraction_status: 'pending',
  });

  state.entities.set('entity-1', {
    id: 'entity-1',
    story_id: STORY,
    type: 'character',
    name: 'Kestrel',
    data: {},
  });

  state.queue.set(JOB, {
    id: JOB,
    chapter_id: CHAPTER,
    story_id: STORY,
    status: 'queued',
  });
});

describe('extraction worker', () => {
  it('applies diffs and marks the chapter extraction-complete on success', async () => {
    const { runOneExtraction } = await import('@/lib/engine/extraction-worker');

    const outcome = await runOneExtraction();

    expect(outcome.claimed).toBe(true);
    expect(outcome.applied).toBe(1);
    expect(state.chapters.get(CHAPTER)?.extraction_status).toBe('complete');
    expect(state.entities.get('entity-1')?.data).toEqual({ location: 'harbor' });
  });

  it('never touches publication fields on success', async () => {
    const { runOneExtraction } = await import('@/lib/engine/extraction-worker');

    await runOneExtraction();

    for (const write of state.chapterWrites) {
      expect(write.prose).toBeUndefined();
      expect(write.published_at).toBeUndefined();
      expect(write.turn_id).toBeUndefined();
    }

    const chapter = state.chapters.get(CHAPTER);
    expect(chapter?.prose).toBe('They walked to the harbor.');
    expect(chapter?.published_at).toBe('2026-08-13T00:00:00Z');
  });

  it('keeps the chapter published when the extractor call fails', async () => {
    const { runOneExtraction } = await import('@/lib/engine/extraction-worker');

    state.extractorBehavior = 'throw';

    await expect(runOneExtraction()).rejects.toThrow('extractor call failed');

    const chapter = state.chapters.get(CHAPTER);
    expect(chapter?.prose).toBe('They walked to the harbor.');
    expect(chapter?.published_at).toBe('2026-08-13T00:00:00Z');
    expect(chapter?.extraction_status).toBe('failed');
  });

  it('keeps the chapter published when the extractor returns unparseable output', async () => {
    const { runOneExtraction } = await import('@/lib/engine/extraction-worker');

    state.extractorBehavior = 'malformed';

    await expect(runOneExtraction()).rejects.toThrow(/unparseable/);

    const chapter = state.chapters.get(CHAPTER);
    expect(chapter?.prose).toBe('They walked to the harbor.');
    expect(chapter?.extraction_status).toBe('failed');
  });

  it('queues the job as failed rather than deleting it, so it can be retried', async () => {
    const { runOneExtraction } = await import('@/lib/engine/extraction-worker');

    state.extractorBehavior = 'throw';
    await expect(runOneExtraction()).rejects.toThrow();

    expect(state.queue.has(JOB)).toBe(true);
    expect(state.queue.get(JOB)?.status).toBe('failed');
  });

  it('reports an empty queue rather than throwing', async () => {
    const { runOneExtraction } = await import('@/lib/engine/extraction-worker');

    state.queue.clear();

    const outcome = await runOneExtraction();

    expect(outcome.claimed).toBe(false);
  });
});
