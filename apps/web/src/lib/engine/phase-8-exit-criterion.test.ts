import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Proof of Phase 8's cross-module chain: image-prompts.ts, chapter-
 * illustration.ts, and media-gateway.ts genuinely compose at runtime, not
 * just in isolation. `runOneImagePromptGeneration` internally calls
 * `queueChapterIllustration` on success — this is the one place in Phase 8
 * where multiple modules actually call into each other rather than being
 * independently triggered, so it's the one worth an integration-level test
 * rather than re-asserting what each module's own unit tests already cover
 * (image-prompts.test.ts, chapter-illustration.test.ts, chapter-video.test.ts,
 * search.test.ts, export.test.ts, share-links.test.ts, marketplace.test.ts).
 *
 * Invariant under test: a chapter publishes, prompts generate and get
 * written, illustration is enabled, and an image gets generated and stored —
 * all without illustration's own failure ever touching the prompt job that
 * triggered it, and without either touching the chapter's publication
 * fields. Also covers the disabled-illustration path composing correctly
 * (prompts still succeed; no image is queued).
 */

const state = vi.hoisted(() => ({
  imagePromptQueue: new Map<string, Record<string, unknown>>(),
  chapters: new Map<string, Record<string, unknown>>(),
  entities: new Map<string, Record<string, unknown>>(),
  stories: new Map<string, Record<string, unknown>>(),
  chapterImages: new Map<string, Record<string, unknown>>(),
  uploads: [] as { bucket: string; path: string }[],
  illustratorBehavior: 'succeed' as 'succeed' | 'throw',
  imageGenBehavior: 'succeed' as 'succeed' | 'throw',
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
      if (state.illustratorBehavior === 'throw') {
        throw new Error('illustrator call failed');
      }
      return {
        data: { prompts: ['A hero silhouetted against a burning skyline.'] },
        resolvedModel: 'm',
        usedFallbackModel: false,
      };
    },
  };
});

vi.mock('@/lib/ai/media-gateway', () => ({
  generateImage: async () => {
    if (state.imageGenBehavior === 'throw') {
      throw new Error('image generation failed');
    }
    return { imageBytes: new Uint8Array([1, 2, 3]), contentType: 'image/png', resolvedModel: 'm', usedFallbackModel: false };
  },
}));

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
      update(values: Record<string, unknown>) {
        if (table === 'chapters') {
          return {
            async eq(_column: string, value: unknown) {
              const existing = state.chapters.get(value as string);
              if (existing !== undefined) state.chapters.set(value as string, { ...existing, ...values });
              return { error: null };
            },
          };
        }
        if (table === 'image_prompt_queue') {
          return {
            async eq(_column: string, value: unknown) {
              const existing = state.imagePromptQueue.get(value as string);
              if (existing !== undefined) state.imagePromptQueue.set(value as string, { ...existing, ...values });
              return { error: null };
            },
          };
        }
        if (table === 'stories') {
          return {
            async eq(_column: string, value: unknown) {
              const existing = state.stories.get(value as string);
              if (existing !== undefined) state.stories.set(value as string, { ...existing, ...values });
              return { error: null };
            },
          };
        }
        // chapter_images: update().eq().select().single()
        return {
          eq(_column: string, value: unknown) {
            const existing = state.chapterImages.get(value as string);
            const updated = existing !== undefined ? { ...existing, ...values } : undefined;
            if (updated !== undefined) state.chapterImages.set(value as string, updated);
            return {
              select() {
                return { async single() { return { data: updated ?? null, error: null }; } };
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
                if (table === 'chapter_images') {
                  const id = `image-${state.chapterImages.size + 1}`;
                  const row = { id, status: 'queued', storage_path: null, error: null, ...values };
                  state.chapterImages.set(id, row);
                  return { data: { id }, error: null };
                }
                return { data: null, error: null };
              },
            };
          },
        };
      },
      async single() {
        if (table === 'chapters') {
          return { data: state.chapters.get(filters.id as string), error: null };
        }
        if (table === 'stories') {
          return { data: state.stories.get(filters.id as string), error: null };
        }
        if (table === 'chapter_images') {
          const row = state.chapterImages.get(filters.id as string);
          const chapter = row !== undefined ? state.chapters.get(row.chapter_id as string) ?? {} : {};
          return { data: row !== undefined ? { ...row, chapters: chapter } : null, error: null };
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
      storage: {
        from: (bucket: string) => ({
          async upload(path: string) {
            state.uploads.push({ bucket, path });
            return { data: { path }, error: null };
          },
        }),
      },
      async rpc(name: string) {
        if (name === 'claim_image_prompt_job') {
          const job = [...state.imagePromptQueue.values()].find((row) => row.status === 'queued');
          if (job === undefined) return { data: null, error: null };
          state.imagePromptQueue.set(job.id as string, { ...job, status: 'claimed' });
          return { data: job, error: null };
        }
        return { data: null, error: null };
      },
    }),
  };
});

const { runOneImagePromptGeneration } = await import('@/lib/engine/image-prompts');

const STORY = 'story-1';
const CHAPTER = 'chapter-1';
const JOB = 'job-1';

beforeEach(() => {
  state.imagePromptQueue.clear();
  state.chapters.clear();
  state.entities.clear();
  state.stories.clear();
  state.chapterImages.clear();
  state.uploads.length = 0;
  state.illustratorBehavior = 'succeed';
  state.imageGenBehavior = 'succeed';

  state.chapters.set(CHAPTER, {
    id: CHAPTER,
    story_id: STORY,
    prose: 'The city burned as the hero descended.',
    entity_ids: [],
    published_at: '2026-08-23T00:00:00Z',
    turn_id: 'turn-1',
    image_prompts: null,
  });
  state.stories.set(STORY, { id: STORY, turn_config: {}, model_config: null });
  state.imagePromptQueue.set(JOB, { id: JOB, chapter_id: CHAPTER, story_id: STORY, status: 'queued' });
});

describe('Phase 8: prompt generation composes with illustration', () => {
  it('with illustration disabled, prompts are written and no image is queued', async () => {
    const outcome = await runOneImagePromptGeneration();

    expect(outcome.claimed).toBe(true);
    expect(state.chapters.get(CHAPTER)?.image_prompts).toEqual(['A hero silhouetted against a burning skyline.']);
    expect(state.chapterImages.size).toBe(0);
  });

  it('with illustration enabled, prompt generation triggers image generation end to end', async () => {
    // Illustration's own opt-in authorization path (requireRole against
    // story_members) is already covered by chapter-illustration.test.ts;
    // the flag is set directly here rather than through setIllustrationEnabled
    // since this test's mock doesn't stub story_members lookups, and the
    // composition under test is prompts -> illustration, not authorization.
    state.stories.set(STORY, { ...state.stories.get(STORY), turn_config: { media: { illustration: true } } });

    const outcome = await runOneImagePromptGeneration();

    expect(outcome.claimed).toBe(true);
    expect(state.chapters.get(CHAPTER)?.image_prompts).toEqual(['A hero silhouetted against a burning skyline.']);
    expect(state.chapterImages.size).toBe(1);
    const image = [...state.chapterImages.values()][0];
    expect(image?.status).toBe('complete');
    expect(state.uploads).toHaveLength(1);
  });

  it('an illustration failure never marks the (already-successful) prompt job as failed', async () => {
    state.stories.set(STORY, { ...state.stories.get(STORY), turn_config: { media: { illustration: true } } });
    state.imageGenBehavior = 'throw';

    const outcome = await runOneImagePromptGeneration();

    expect(outcome.claimed).toBe(true);
    expect(state.imagePromptQueue.get(JOB)?.status).toBe('complete');
    expect(state.chapters.get(CHAPTER)?.image_prompts).toEqual(['A hero silhouetted against a burning skyline.']);
    const image = [...state.chapterImages.values()][0];
    expect(image?.status).toBe('failed');
  });

  it('publication fields are never touched by either step', async () => {
    state.stories.set(STORY, { ...state.stories.get(STORY), turn_config: { media: { illustration: true } } });

    await runOneImagePromptGeneration();

    const chapter = state.chapters.get(CHAPTER);
    expect(chapter?.prose).toBe('The city burned as the hero descended.');
    expect(chapter?.published_at).toBe('2026-08-23T00:00:00Z');
    expect(chapter?.turn_id).toBe('turn-1');
  });
});
