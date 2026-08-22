import 'server-only';

import { generateImage } from '@/lib/ai/media-gateway';
import { createBudgetGuard } from '@/lib/ai/spend';
import { createUsageRecorder } from '@/lib/ai/usage';
import { requireRole } from '@/lib/engine/membership';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * Manga-panel image generation (Phase 8 — chapter-illustration capability).
 *
 * Opt-in per story, disabled by default, stored at
 * `stories.turn_config.media.illustration` — same jsonb-merge pattern
 * `mode-switching.ts` uses for `active_mode`, preserving unrelated
 * `turn_config` keys.
 *
 * Generation is triggered once a chapter's `image_prompts` are written (see
 * `image-prompts.ts`) and never blocks publication, prompt generation, or
 * anything else — a failure here only ever touches its own `chapter_images`
 * row.
 */

const BUCKET = 'chapter-images';

export interface ChapterImageRecord {
  id: string;
  chapterId: string;
  storyId: string;
  prompt: string | null;
  storagePath: string | null;
  status: 'queued' | 'complete' | 'failed';
  error: string | null;
}

interface ChapterImageRow {
  id: string;
  chapter_id: string;
  story_id: string;
  prompt: string | null;
  storage_path: string | null;
  status: string;
  error: string | null;
}

function toChapterImageRecord(row: ChapterImageRow): ChapterImageRecord {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    storyId: row.story_id,
    prompt: row.prompt,
    storagePath: row.storage_path,
    status: row.status as ChapterImageRecord['status'],
    error: row.error,
  };
}

const CHAPTER_IMAGE_COLUMNS = 'id, chapter_id, story_id, prompt, storage_path, status, error';

async function mergeTurnConfig(storyId: string, patch: (current: Record<string, unknown>) => Record<string, unknown>) {
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
  const nextConfig = patch(turnConfig);

  const { error: updateError } = await supabase
    .from('stories')
    .update({ turn_config: toJson(nextConfig) })
    .eq('id', storyId);

  if (updateError !== null) {
    throw new Error(`Failed to update story turn_config: ${updateError.message}`);
  }
}

function withMediaFlag(
  turnConfig: Record<string, unknown>,
  key: 'illustration' | 'video',
  enabled: boolean,
): Record<string, unknown> {
  const media = (turnConfig.media ?? {}) as Record<string, unknown>;
  return { ...turnConfig, media: { ...media, [key]: enabled } };
}

export function isIllustrationEnabled(turnConfig: Record<string, unknown> | null | undefined): boolean {
  const media = (turnConfig?.media ?? {}) as Record<string, unknown>;
  return media.illustration === true;
}

/** Owner/GM only. Disabling stops future generation; existing images are kept. */
export async function setIllustrationEnabled(storyId: string, userId: string, enabled: boolean): Promise<void> {
  await requireRole(storyId, userId, ['owner', 'gm']);
  await mergeTurnConfig(storyId, (current) => withMediaFlag(current, 'illustration', enabled));
}

/**
 * Called once a chapter's `image_prompts` are written. Queues one
 * `chapter_images` row per prompt (only when the story has illustration
 * enabled) and dispatches generation for each. Never throws on an individual
 * generation failure — each image's own row records that.
 */
export async function queueChapterIllustration(chapterId: string, storyId: string, prompts: readonly string[]): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('turn_config')
    .eq('id', storyId)
    .single();

  if (storyError !== null) {
    throw new Error(`Failed to read story turn_config: ${storyError.message}`);
  }

  if (!isIllustrationEnabled(story.turn_config as Record<string, unknown> | null)) {
    return;
  }

  for (const prompt of prompts) {
    const { data, error } = await supabase
      .from('chapter_images')
      .insert({ chapter_id: chapterId, story_id: storyId, prompt, status: 'queued' })
      .select('id')
      .single();

    if (error !== null) {
      throw new Error(`Failed to queue chapter image: ${error.message}`);
    }

    await generateChapterImage(data.id);
  }
}

/**
 * Owner/GM only. Reuses the chapter's existing `image_prompts` — does not
 * regenerate them — and queues fresh `chapter_images` rows regardless of
 * whether prior images exist.
 */
export async function regenerateChapterImages(chapterId: string, userId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: chapter, error: chapterError } = await supabase
    .from('chapters')
    .select('story_id, image_prompts')
    .eq('id', chapterId)
    .single();

  if (chapterError !== null) {
    throw new Error(`Failed to read chapter: ${chapterError.message}`);
  }

  await requireRole(chapter.story_id, userId, ['owner', 'gm']);

  const prompts = Array.isArray(chapter.image_prompts) ? (chapter.image_prompts as string[]) : [];

  if (prompts.length === 0) {
    throw new Error('Chapter has no image prompts to regenerate from.');
  }

  for (const prompt of prompts) {
    const { data, error } = await supabase
      .from('chapter_images')
      .insert({ chapter_id: chapterId, story_id: chapter.story_id, prompt, status: 'queued' })
      .select('id')
      .single();

    if (error !== null) {
      throw new Error(`Failed to queue chapter image: ${error.message}`);
    }

    await generateChapterImage(data.id);
  }
}

/**
 * Renders one `chapter_images` row's image and uploads it to Storage.
 * Failure marks the row `failed` with the error; it never touches the
 * chapter, the prompt queue, or any other `chapter_images` row.
 */
export async function generateChapterImage(chapterImageId: string): Promise<ChapterImageRecord> {
  const supabase = createServiceRoleClient();

  const { data: row, error: readError } = await supabase
    .from('chapter_images')
    .select(CHAPTER_IMAGE_COLUMNS)
    .eq('id', chapterImageId)
    .single();

  if (readError !== null) {
    throw new Error(`Failed to read chapter_images row: ${readError.message}`);
  }

  const storyResult = await supabase.from('stories').select('model_config').eq('id', row.story_id).single();
  if (storyResult.error !== null) {
    throw new Error(`Failed to read story: ${storyResult.error.message}`);
  }

  try {
    const result = await generateImage(
      {
        openRouterApiKey: serverEnv().OPENROUTER_API_KEY,
        videoProviderApiKey: '',
        usage: createUsageRecorder(row.story_id, null),
        budget: createBudgetGuard(row.story_id, null),
      },
      { modelConfig: storyResult.data.model_config as never, prompt: row.prompt ?? '', storyId: row.story_id },
    );

    const extension = result.contentType.split('/')[1] ?? 'png';
    const storagePath = `${row.story_id}/${row.chapter_id}/${chapterImageId}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, result.imageBytes, { contentType: result.contentType, upsert: true });

    if (uploadError !== null) {
      throw new Error(`Failed to upload chapter image: ${uploadError.message}`);
    }

    const { data: updated, error: updateError } = await supabase
      .from('chapter_images')
      .update({ status: 'complete', storage_path: storagePath, error: null })
      .eq('id', chapterImageId)
      .select(CHAPTER_IMAGE_COLUMNS)
      .single();

    if (updateError !== null) {
      throw new Error(`Failed to update chapter_images row: ${updateError.message}`);
    }

    return toChapterImageRecord(updated);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    const { data: updated, error: updateError } = await supabase
      .from('chapter_images')
      .update({ status: 'failed', error: message.slice(0, 2000) })
      .eq('id', chapterImageId)
      .select(CHAPTER_IMAGE_COLUMNS)
      .single();

    if (updateError !== null) {
      throw new Error(`Failed to update chapter_images row: ${updateError.message}`);
    }

    return toChapterImageRecord(updated);
  }
}
