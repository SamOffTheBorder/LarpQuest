import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The invariant under test: image prompt generation runs strictly after
 * publication and can never affect it. The only field this worker is allowed
 * to change is chapters.image_prompts (on success) — publication fields are
 * untouched on every path, success or failure, same discipline as the
 * extraction worker.
 */

const state = vi.hoisted(() => ({
  queue: new Map<string, Record<string, unknown>>(),
  chapters: new Map<string, Record<string, unknown>>(),
  entities: new Map<string, Record<string, unknown>>(),
  chapterWrites: [] as Record<string, unknown>[],
  illustratorBehavior: 'succeed' as 'succeed' | 'throw' | 'malformed',
  capturedPrompts: [] as string[],
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
    callStructured: async (_deps: unknown, args: { userPrompt: string }) => {
      state.capturedPrompts.push(args.userPrompt);

      if (state.illustratorBehavior === 'throw') {
        throw new Error('illustrator call failed');
      }

      if (state.illustratorBehavior === 'malformed') {
        throw new actual.StructuredOutputError('illustrator', 2, 'not json', new Error('bad'));
      }

      return {
        data: { prompts: ['A lone figure stands atop a rain-slicked rooftop at dusk.'] },
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
      async rpc(name: string) {
        if (name === 'claim_image_prompt_job') {
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
  state.entities.clear();
  state.chapterWrites.length = 0;
  state.illustratorBehavior = 'succeed';
  state.capturedPrompts.length = 0;

  state.chapters.set(CHAPTER, {
    id: CHAPTER,
    story_id: STORY,
    prose: 'They walked to the harbor as the storm broke.',
    entity_ids: ['entity-1'],
    published_at: '2026-08-13T00:00:00Z',
    turn_id: 'turn-1',
    image_prompts: null,
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

describe('image prompt worker', () => {
  it('writes generated prompts to chapters.image_prompts on success', async () => {
    const { runOneImagePromptGeneration } = await import('@/lib/engine/image-prompts');

    const outcome = await runOneImagePromptGeneration();

    expect(outcome.claimed).toBe(true);
    expect(outcome.promptCount).toBe(1);
    expect(state.chapters.get(CHAPTER)?.image_prompts).toEqual([
      'A lone figure stands atop a rain-slicked rooftop at dusk.',
    ]);
  });

  it('never touches publication fields on success', async () => {
    const { runOneImagePromptGeneration } = await import('@/lib/engine/image-prompts');

    await runOneImagePromptGeneration();

    for (const write of state.chapterWrites) {
      expect(write.prose).toBeUndefined();
      expect(write.published_at).toBeUndefined();
      expect(write.turn_id).toBeUndefined();
    }
  });

  it('leaves the chapter published and image_prompts unset when the illustrator call fails', async () => {
    const { runOneImagePromptGeneration } = await import('@/lib/engine/image-prompts');

    state.illustratorBehavior = 'throw';

    await expect(runOneImagePromptGeneration()).rejects.toThrow('illustrator call failed');

    const chapter = state.chapters.get(CHAPTER);
    expect(chapter?.prose).toBe('They walked to the harbor as the storm broke.');
    expect(chapter?.published_at).toBe('2026-08-13T00:00:00Z');
    expect(chapter?.image_prompts).toBeNull();
  });

  it('leaves the chapter published when the illustrator returns unparseable output', async () => {
    const { runOneImagePromptGeneration } = await import('@/lib/engine/image-prompts');

    state.illustratorBehavior = 'malformed';

    await expect(runOneImagePromptGeneration()).rejects.toThrow(/unparseable/);

    const chapter = state.chapters.get(CHAPTER);
    expect(chapter?.image_prompts).toBeNull();
  });

  it('queues the job as failed rather than deleting it, so it can be retried', async () => {
    const { runOneImagePromptGeneration } = await import('@/lib/engine/image-prompts');

    state.illustratorBehavior = 'throw';
    await expect(runOneImagePromptGeneration()).rejects.toThrow();

    expect(state.queue.has(JOB)).toBe(true);
    expect(state.queue.get(JOB)?.status).toBe('failed');
  });

  it('reports an empty queue rather than throwing', async () => {
    const { runOneImagePromptGeneration } = await import('@/lib/engine/image-prompts');

    state.queue.clear();

    const outcome = await runOneImagePromptGeneration();

    expect(outcome.claimed).toBe(false);
  });
});

describe('image prompt generation is genre-agnostic', () => {
  it('succeeds identically for a power-system entity and a knowledge-only entity', async () => {
    const { runOneImagePromptGeneration } = await import('@/lib/engine/image-prompts');

    state.entities.set('entity-1', {
      id: 'entity-1',
      story_id: STORY,
      type: 'character',
      name: 'Ashfall Vigil',
      data: { abilities: [{ name: 'pyrokinesis' }], powerLevel: 7 },
    });

    const powerOutcome = await runOneImagePromptGeneration();
    expect(powerOutcome.claimed).toBe(true);

    state.queue.set(JOB, { id: JOB, chapter_id: CHAPTER, story_id: STORY, status: 'queued' });
    state.chapters.set(CHAPTER, { ...state.chapters.get(CHAPTER), image_prompts: null });
    state.entities.set('entity-1', {
      id: 'entity-1',
      story_id: STORY,
      type: 'character',
      name: 'Archivist Wren',
      data: { knownFacts: ['the letter was forged'], suspicionLevel: 'low' },
    });

    const knowledgeOutcome = await runOneImagePromptGeneration();
    expect(knowledgeOutcome.claimed).toBe(true);

    // Same code path produced both — no branch keyed on either shape.
    expect(state.capturedPrompts).toHaveLength(2);
  });
});
