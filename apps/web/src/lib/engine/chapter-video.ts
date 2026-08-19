import 'server-only';

import { inngest } from '@/inngest/client';
import { requireRole } from '@/lib/engine/membership';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * Anime-style video generation opt-in and request path (Phase 8 —
 * chapter-video capability). Off by default given cost, same
 * `turn_config.media` jsonb-merge pattern `chapter-illustration.ts` uses for
 * illustration, kept as a sibling key so the two flags are independent.
 *
 * The actual generation runs in `generate-chapter-video.ts` (Inngest); this
 * module only validates the request (image must be ready, flag must be on)
 * and dispatches the event.
 */

export interface ChapterVideoRecord {
  id: string;
  chapterId: string;
  storyId: string;
  storagePath: string | null;
  status: 'queued' | 'running' | 'complete' | 'failed';
  error: string | null;
}

interface ChapterVideoRow {
  id: string;
  chapter_id: string;
  story_id: string;
  storage_path: string | null;
  status: string;
  error: string | null;
}

function toChapterVideoRecord(row: ChapterVideoRow): ChapterVideoRecord {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    storyId: row.story_id,
    storagePath: row.storage_path,
    status: row.status as ChapterVideoRecord['status'],
    error: row.error,
  };
}

const CHAPTER_VIDEO_COLUMNS = 'id, chapter_id, story_id, storage_path, status, error';

export function isVideoEnabled(turnConfig: Record<string, unknown> | null | undefined): boolean {
  const media = (turnConfig?.media ?? {}) as Record<string, unknown>;
  return media.video === true;
}

/** Owner/GM only. Off by default. */
export async function setVideoEnabled(storyId: string, userId: string, enabled: boolean): Promise<void> {
  await requireRole(storyId, userId, ['owner', 'gm']);

  const supabase = createServiceRoleClient();

  const { data: story, error: readError } = await supabase
    .from('stories')
    .select('turn_config')
    .eq('id', storyId)
    .single();

  if (readError !== null) {
    throw new Error(`Failed to read story turn_config: ${readError.message}`);
  }

  const turnConfig = (story.turn_config ?? {}) as Record<string, unknown>;
  const media = (turnConfig.media ?? {}) as Record<string, unknown>;
  const nextConfig = { ...turnConfig, media: { ...media, video: enabled } };

  const { error: updateError } = await supabase
    .from('stories')
    .update({ turn_config: toJson(nextConfig) })
    .eq('id', storyId);

  if (updateError !== null) {
    throw new Error(`Failed to update story turn_config: ${updateError.message}`);
  }
}

/**
 * Owner/GM only. Requires the story to have video enabled and the chapter to
 * have at least one `complete` chapter_images row — video is seeded from a
 * chapter's illustration, so there is nothing to animate without one.
 */
export async function requestChapterVideo(chapterId: string, userId: string): Promise<ChapterVideoRecord> {
  const supabase = createServiceRoleClient();

  const { data: chapter, error: chapterError } = await supabase
    .from('chapters')
    .select('story_id')
    .eq('id', chapterId)
    .single();

  if (chapterError !== null) {
    throw new Error(`Failed to read chapter: ${chapterError.message}`);
  }

  await requireRole(chapter.story_id, userId, ['owner', 'gm']);

  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('turn_config')
    .eq('id', chapter.story_id)
    .single();

  if (storyError !== null) {
    throw new Error(`Failed to read story turn_config: ${storyError.message}`);
  }

  if (!isVideoEnabled(story.turn_config as Record<string, unknown> | null)) {
    throw new Error('Video generation is not enabled for this story.');
  }

  if (serverEnv().VIDEO_PROVIDER_API_KEY === undefined) {
    // The flag can be enabled independent of whether this deployment has
    // ever provisioned a video provider — fail clearly here rather than
    // dispatching a job that can only fail with an opaque provider-auth
    // error (or silently hit media-gateway.ts's placeholder base URL).
    throw new Error('Video generation is not configured on this deployment (VIDEO_PROVIDER_API_KEY is unset).');
  }

  const { data: readyImage, error: imageError } = await supabase
    .from('chapter_images')
    .select('id')
    .eq('chapter_id', chapterId)
    .eq('status', 'complete')
    .limit(1)
    .maybeSingle();

  if (imageError !== null) {
    throw new Error(`Failed to check chapter images: ${imageError.message}`);
  }

  if (readyImage === null) {
    throw new Error('Chapter has no completed image to seed video generation from.');
  }

  const { data: created, error: insertError } = await supabase
    .from('chapter_videos')
    .insert({ chapter_id: chapterId, story_id: chapter.story_id, status: 'queued' })
    .select(CHAPTER_VIDEO_COLUMNS)
    .single();

  if (insertError !== null) {
    throw new Error(`Failed to create chapter_videos row: ${insertError.message}`);
  }

  await inngest.send({ name: 'chapter/video.requested', data: { chapterVideoId: created.id } });

  return toChapterVideoRecord(created);
}

/** Owner/GM only. Re-dispatches generation reusing the chapter's existing image(s). */
export async function retryChapterVideo(chapterVideoId: string, userId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: row, error: readError } = await supabase
    .from('chapter_videos')
    .select('story_id')
    .eq('id', chapterVideoId)
    .single();

  if (readError !== null) {
    throw new Error(`Failed to read chapter_videos row: ${readError.message}`);
  }

  await requireRole(row.story_id, userId, ['owner', 'gm']);

  if (serverEnv().VIDEO_PROVIDER_API_KEY === undefined) {
    throw new Error('Video generation is not configured on this deployment (VIDEO_PROVIDER_API_KEY is unset).');
  }

  const { error: updateError } = await supabase
    .from('chapter_videos')
    .update({ status: 'queued', error: null })
    .eq('id', chapterVideoId);

  if (updateError !== null) {
    throw new Error(`Failed to reset chapter_videos row: ${updateError.message}`);
  }

  await inngest.send({ name: 'chapter/video.requested', data: { chapterVideoId } });
}
