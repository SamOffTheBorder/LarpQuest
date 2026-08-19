import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Video opt-in/request path against a fake database + fake Inngest client.
 * Invariants under test: off by default (including when illustration is on
 * but video is off); only owner/gm can toggle or request; a job is only
 * dispatched once a chapter has a completed image; retry re-dispatches
 * without creating a new row.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, string>(),
  stories: new Map<string, Record<string, unknown>>(),
  chapters: new Map<string, Record<string, unknown>>(),
  chapterImages: new Map<string, Record<string, unknown>>(),
  chapterVideos: new Map<string, Record<string, unknown>>(),
  sentEvents: [] as { name: string; data: Record<string, unknown> }[],
  videoProviderConfigured: true,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ VIDEO_PROVIDER_API_KEY: state.videoProviderConfigured ? 'test-provider-key' : undefined }),
  clientEnv: {},
}));

vi.mock('@/inngest/client', () => ({
  inngest: {
    send: async (event: { name: string; data: Record<string, unknown> }) => {
      state.sentEvents.push(event);
    },
  },
}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const filters: Record<string, unknown> = {};
    let statusFilter: string | undefined;

    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        if (column === 'status') statusFilter = value as string;
        filters[column] = value;
        return builder;
      },
      limit() {
        return builder;
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const role = state.members.get(`${filters.story_id}:${filters.user_id}`);
          return { data: role !== undefined ? { role } : null, error: null };
        }
        if (table === 'chapter_images') {
          const match = [...state.chapterImages.values()].find(
            (row) => row.chapter_id === filters.chapter_id && (statusFilter === undefined || row.status === statusFilter),
          );
          return { data: match ?? null, error: null };
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
        if (table === 'chapter_videos') {
          const row = state.chapterVideos.get(filters.id as string);
          return { data: row ?? null, error: row === undefined ? { message: 'not found' } : null };
        }
        return { data: null, error: null };
      },
      update(values: Record<string, unknown>) {
        return {
          eq(_column: string, value: unknown) {
            if (table === 'stories') {
              const existing = state.stories.get(value as string);
              if (existing !== undefined) state.stories.set(value as string, { ...existing, ...values });
            }
            if (table === 'chapter_videos') {
              const existing = state.chapterVideos.get(value as string);
              if (existing !== undefined) state.chapterVideos.set(value as string, { ...existing, ...values });
            }
            return { error: null };
          },
        };
      },
      insert(values: Record<string, unknown>) {
        return {
          select() {
            return {
              async single() {
                if (table === 'chapter_videos') {
                  const id = `video-${state.chapterVideos.size + 1}`;
                  const row = { id, status: 'queued', storage_path: null, error: null, ...values };
                  state.chapterVideos.set(id, row);
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

  return { createServiceRoleClient: () => ({ from }) };
});

const { setVideoEnabled, isVideoEnabled, requestChapterVideo, retryChapterVideo } = await import(
  '@/lib/engine/chapter-video'
);

const STORY = 'story-1';
const CHAPTER = 'chapter-1';
const OWNER = 'owner-1';
const PLAYER = 'player-1';

beforeEach(() => {
  state.members.clear();
  state.stories.clear();
  state.chapters.clear();
  state.chapterImages.clear();
  state.chapterVideos.clear();
  state.sentEvents.length = 0;
  state.videoProviderConfigured = true;

  state.members.set(`${STORY}:${OWNER}`, 'owner');
  state.members.set(`${STORY}:${PLAYER}`, 'player');
  state.stories.set(STORY, { id: STORY, turn_config: {} });
  state.chapters.set(CHAPTER, { id: CHAPTER, story_id: STORY });
});

describe('video opt-in', () => {
  it('is disabled by default', () => {
    expect(isVideoEnabled(state.stories.get(STORY)?.turn_config as Record<string, unknown>)).toBe(false);
  });

  it('is disabled by default even when illustration is separately enabled', () => {
    state.stories.set(STORY, { ...state.stories.get(STORY), turn_config: { media: { illustration: true } } });

    expect(isVideoEnabled(state.stories.get(STORY)?.turn_config as Record<string, unknown>)).toBe(false);
  });

  it('owner can enable it', async () => {
    await setVideoEnabled(STORY, OWNER, true);

    expect(isVideoEnabled(state.stories.get(STORY)?.turn_config as Record<string, unknown>)).toBe(true);
  });

  it('player cannot toggle it', async () => {
    await expect(setVideoEnabled(STORY, PLAYER, true)).rejects.toThrow();
  });
});

describe('requestChapterVideo', () => {
  it('rejects when video is not enabled', async () => {
    state.chapterImages.set('img-1', { id: 'img-1', chapter_id: CHAPTER, status: 'complete' });

    await expect(requestChapterVideo(CHAPTER, OWNER)).rejects.toThrow(/not enabled/);
  });

  it('rejects when no image is complete yet', async () => {
    await setVideoEnabled(STORY, OWNER, true);

    await expect(requestChapterVideo(CHAPTER, OWNER)).rejects.toThrow(/no completed image/i);
  });

  it('dispatches a job once video is enabled and an image is complete', async () => {
    await setVideoEnabled(STORY, OWNER, true);
    state.chapterImages.set('img-1', { id: 'img-1', chapter_id: CHAPTER, status: 'complete' });

    const record = await requestChapterVideo(CHAPTER, OWNER);

    expect(record.status).toBe('queued');
    expect(state.sentEvents).toHaveLength(1);
    expect(state.sentEvents[0]).toMatchObject({
      name: 'chapter/video.requested',
      data: { chapterVideoId: record.id },
    });
  });

  it('is owner/gm gated', async () => {
    await setVideoEnabled(STORY, OWNER, true);
    state.chapterImages.set('img-1', { id: 'img-1', chapter_id: CHAPTER, status: 'complete' });

    await expect(requestChapterVideo(CHAPTER, PLAYER)).rejects.toThrow();
    expect(state.sentEvents).toHaveLength(0);
  });

  it('rejects with a clear error when the deployment has no video provider configured', async () => {
    await setVideoEnabled(STORY, OWNER, true);
    state.chapterImages.set('img-1', { id: 'img-1', chapter_id: CHAPTER, status: 'complete' });
    state.videoProviderConfigured = false;

    await expect(requestChapterVideo(CHAPTER, OWNER)).rejects.toThrow(/not configured/);
    expect(state.sentEvents).toHaveLength(0);
  });
});

describe('retryChapterVideo', () => {
  it('resets status to queued and re-dispatches the event', async () => {
    state.chapterVideos.set('video-1', {
      id: 'video-1',
      chapter_id: CHAPTER,
      story_id: STORY,
      status: 'failed',
      error: 'boom',
      storage_path: null,
    });

    await retryChapterVideo('video-1', OWNER);

    expect(state.chapterVideos.get('video-1')?.status).toBe('queued');
    expect(state.chapterVideos.get('video-1')?.error).toBeNull();
    expect(state.sentEvents).toHaveLength(1);
    expect(state.sentEvents[0]?.data).toEqual({ chapterVideoId: 'video-1' });
  });

  it('is owner/gm gated', async () => {
    state.chapterVideos.set('video-1', { id: 'video-1', chapter_id: CHAPTER, story_id: STORY, status: 'failed' });

    await expect(retryChapterVideo('video-1', PLAYER)).rejects.toThrow();
    expect(state.sentEvents).toHaveLength(0);
  });
});
