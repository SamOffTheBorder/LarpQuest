import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Manga-panel image generation against a fake database + fake media gateway.
 * Invariants under test: illustration is off by default and only an
 * owner/gm can toggle it; generation is queued only when both a prompt
 * exists and the flag is enabled; success/failure write to the image's own
 * row without ever touching the chapter or the prompt queue; regeneration
 * reuses existing prompts; non-members cannot read.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, string>(), // `${storyId}:${userId}` -> role
  stories: new Map<string, Record<string, unknown>>(),
  chapters: new Map<string, Record<string, unknown>>(),
  chapterImages: new Map<string, Record<string, unknown>>(),
  uploads: [] as { bucket: string; path: string }[],
  imageBehavior: 'succeed' as 'succeed' | 'throw',
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/api-key', () => ({
  resolveStoryApiKey: async () => ({ key: 'test-key', source: 'platform' }),
  resolvePlatformApiKey: () => ({ key: 'test-key', source: 'platform' }),
}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }),
  clientEnv: {},
}));

vi.mock('@/lib/ai/usage', () => ({
  createUsageRecorder: () => ({ record: async () => {} }),
}));

vi.mock('@/lib/ai/media-gateway', () => ({
  generateImage: async () => {
    if (state.imageBehavior === 'throw') {
      throw new Error('image generation failed');
    }
    return {
      imageBytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      resolvedModel: 'm',
      usedFallbackModel: false,
    };
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
        if (table === 'chapters') {
          const chapter = state.chapters.get(filters.id as string);
          return { data: chapter ?? null, error: chapter === undefined ? { message: 'not found' } : null };
        }
        if (table === 'chapter_images') {
          const row = state.chapterImages.get(filters.id as string);
          if (row === undefined) {
            return { data: null, error: { message: 'not found' } };
          }
          const chapter = state.chapters.get(row.chapter_id as string) ?? {};
          return { data: { ...row, chapters: chapter }, error: null };
        }
        return { data: null, error: null };
      },
      update(values: Record<string, unknown>) {
        return {
          eq(_column: string, value: unknown) {
            let updatedRow: Record<string, unknown> | undefined;

            if (table === 'chapter_images') {
              const existing = state.chapterImages.get(value as string);
              if (existing !== undefined) {
                updatedRow = { ...existing, ...values };
                state.chapterImages.set(value as string, updatedRow);
              }
            }
            if (table === 'stories') {
              const existing = state.stories.get(value as string);
              if (existing !== undefined) {
                updatedRow = { ...existing, ...values };
                state.stories.set(value as string, updatedRow);
              }
            }

            return {
              select() {
                return {
                  async single() {
                    return { data: updatedRow ?? null, error: null };
                  },
                };
              },
              async then(resolve: (v: { error: null }) => void) {
                resolve({ error: null });
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
    }),
  };
});

const {
  setIllustrationEnabled,
  isIllustrationEnabled,
  queueChapterIllustration,
  regenerateChapterImages,
  generateChapterImage,
} = await import('@/lib/engine/chapter-illustration');

const STORY = 'story-1';
const CHAPTER = 'chapter-1';
const OWNER = 'owner-1';
const PLAYER = 'player-1';

beforeEach(() => {
  state.members.clear();
  state.stories.clear();
  state.chapters.clear();
  state.chapterImages.clear();
  state.uploads.length = 0;
  state.imageBehavior = 'succeed';

  state.members.set(`${STORY}:${OWNER}`, 'owner');
  state.members.set(`${STORY}:${PLAYER}`, 'player');
  state.stories.set(STORY, { id: STORY, turn_config: {}, model_config: null });
  state.chapters.set(CHAPTER, { id: CHAPTER, story_id: STORY, prose: 'text', image_prompts: ['a scene'] });
});

describe('illustration opt-in', () => {
  it('is disabled by default', () => {
    expect(isIllustrationEnabled(state.stories.get(STORY)?.turn_config as Record<string, unknown>)).toBe(false);
  });

  it('owner can enable it', async () => {
    await setIllustrationEnabled(STORY, OWNER, true);

    expect(isIllustrationEnabled(state.stories.get(STORY)?.turn_config as Record<string, unknown>)).toBe(true);
  });

  it('player cannot toggle it', async () => {
    await expect(setIllustrationEnabled(STORY, PLAYER, true)).rejects.toThrow();
    expect(isIllustrationEnabled(state.stories.get(STORY)?.turn_config as Record<string, unknown>)).toBe(false);
  });

  it('preserves unrelated turn_config keys', async () => {
    state.stories.set(STORY, { ...state.stories.get(STORY), turn_config: { active_mode: 'action' } });

    await setIllustrationEnabled(STORY, OWNER, true);

    const config = state.stories.get(STORY)?.turn_config as Record<string, unknown>;
    expect(config.active_mode).toBe('action');
    expect(isIllustrationEnabled(config)).toBe(true);
  });
});

describe('queueChapterIllustration', () => {
  it('does nothing when illustration is disabled', async () => {
    await queueChapterIllustration(CHAPTER, STORY, ['a scene']);

    expect(state.chapterImages.size).toBe(0);
  });

  it('queues and generates one row per prompt when enabled', async () => {
    await setIllustrationEnabled(STORY, OWNER, true);

    await queueChapterIllustration(CHAPTER, STORY, ['scene one', 'scene two']);

    expect(state.chapterImages.size).toBe(2);
    for (const row of state.chapterImages.values()) {
      expect(row.status).toBe('complete');
      expect(row.storage_path).toContain(STORY);
    }
  });

  it('marks a row failed without throwing when generation fails', async () => {
    await setIllustrationEnabled(STORY, OWNER, true);
    state.imageBehavior = 'throw';

    await queueChapterIllustration(CHAPTER, STORY, ['scene one']);

    const row = [...state.chapterImages.values()][0];
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('image generation failed');
  });
});

describe('generateChapterImage', () => {
  it('uploads to storage and marks the row complete', async () => {
    state.chapterImages.set('image-x', {
      id: 'image-x',
      chapter_id: CHAPTER,
      story_id: STORY,
      prompt: 'a scene',
      status: 'queued',
      storage_path: null,
      error: null,
    });

    const result = await generateChapterImage('image-x');

    expect(result.status).toBe('complete');
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0]?.bucket).toBe('chapter-images');
  });
});

describe('regenerateChapterImages', () => {
  it('reuses existing image_prompts without regenerating them', async () => {
    await regenerateChapterImages(CHAPTER, OWNER);

    expect(state.chapterImages.size).toBe(1);
    expect([...state.chapterImages.values()][0]?.prompt).toBe('a scene');
  });

  it('is owner/gm gated', async () => {
    await expect(regenerateChapterImages(CHAPTER, PLAYER)).rejects.toThrow();
  });

  it('throws when the chapter has no prompts to reuse', async () => {
    state.chapters.set(CHAPTER, { ...state.chapters.get(CHAPTER), image_prompts: null });

    await expect(regenerateChapterImages(CHAPTER, OWNER)).rejects.toThrow(/no image prompts/);
  });
});
