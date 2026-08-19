import 'server-only';

import type { GetStepTools } from 'inngest';

import { inngest } from '@/inngest/client';
import { generateVideo } from '@/lib/ai/media-gateway';
import { createUsageRecorder } from '@/lib/ai/usage';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Anime-style video generation (Phase 8 — chapter-video capability).
 *
 * Video generation takes minutes, unlike image generation's seconds, so it
 * gets its own Inngest job rather than the queued-task pattern
 * image-prompts.ts/chapter-illustration.ts use — same reasoning the research
 * pipeline already established for genuinely long-running, progress-tracked
 * work (design.md decision 3).
 *
 * Two steps: fetch the chapter's completed image + generate the video, then
 * upload it. Each is independently retried/memoized by Inngest. A failure in
 * either only ever updates this chapter_videos row — publication, image
 * generation, and every other chapter/story field are unreachable from here.
 */

const BUCKET = 'chapter-videos';

interface ChapterVideoRequestedEvent {
  name: 'chapter/video.requested';
  data: { chapterVideoId: string };
}

export const generateChapterVideo = inngest.createFunction(
  { id: 'generate-chapter-video', retries: 2, triggers: [{ event: 'chapter/video.requested' }] },
  async ({ event, step }: { event: ChapterVideoRequestedEvent; step: GetStepTools<typeof inngest> }) => {
    const { chapterVideoId } = event.data;
    const supabase = createServiceRoleClient();

    await step.run('mark-running', async () => {
      await supabase.from('chapter_videos').update({ status: 'running' }).eq('id', chapterVideoId);
    });

    try {
      const generated = await step.run('generate-video', async () => {
        const { data: row, error: rowError } = await supabase
          .from('chapter_videos')
          .select('chapter_id, story_id')
          .eq('id', chapterVideoId)
          .single();

        if (rowError !== null) {
          throw new Error(`Failed to read chapter_videos row: ${rowError.message}`);
        }

        const [chapterResult, imageResult, storyResult] = await Promise.all([
          supabase.from('chapters').select('prose').eq('id', row.chapter_id).single(),
          supabase
            .from('chapter_images')
            .select('storage_path')
            .eq('chapter_id', row.chapter_id)
            .eq('status', 'complete')
            .limit(1)
            .single(),
          supabase.from('stories').select('model_config').eq('id', row.story_id).single(),
        ]);

        if (chapterResult.error !== null) {
          throw new Error(`Failed to read chapter: ${chapterResult.error.message}`);
        }
        if (imageResult.error !== null || imageResult.data.storage_path === null) {
          throw new Error('No completed chapter image to seed video generation from.');
        }
        if (storyResult.error !== null) {
          throw new Error(`Failed to read story: ${storyResult.error.message}`);
        }

        const { data: imageBlob, error: downloadError } = await supabase.storage
          .from('chapter-images')
          .download(imageResult.data.storage_path);

        if (downloadError !== null || imageBlob === null) {
          throw new Error(`Failed to download source image: ${downloadError?.message ?? 'no data'}`);
        }

        const sourceImageBytes = new Uint8Array(await imageBlob.arrayBuffer());
        const sourceImageContentType = imageBlob.type || 'image/png';

        const baseUrl = serverEnv().VIDEO_PROVIDER_BASE_URL;

        const result = await generateVideo(
          {
            openRouterApiKey: serverEnv().OPENROUTER_API_KEY,
            videoProviderApiKey: serverEnv().VIDEO_PROVIDER_API_KEY ?? '',
            ...(baseUrl !== undefined ? { videoProviderBaseUrl: baseUrl } : {}),
            usage: createUsageRecorder(row.story_id, null),
          },
          {
            modelConfig: storyResult.data.model_config as never,
            sourceImageBytes,
            sourceImageContentType,
            prompt: chapterResult.data.prose,
            storyId: row.story_id,
          },
        );

        return {
          storyId: row.story_id,
          chapterId: row.chapter_id,
          videoBytes: Array.from(result.videoBytes),
          contentType: result.contentType,
        };
      });

      await step.run('upload-and-complete', async () => {
        const storagePath = `${generated.storyId}/${generated.chapterId}/${chapterVideoId}.mp4`;

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, new Uint8Array(generated.videoBytes), {
            contentType: generated.contentType,
            upsert: true,
          });

        if (uploadError !== null) {
          throw new Error(`Failed to upload chapter video: ${uploadError.message}`);
        }

        await supabase
          .from('chapter_videos')
          .update({ status: 'complete', storage_path: storagePath, error: null })
          .eq('id', chapterVideoId);
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);

      await step.run('mark-failed', async () => {
        await supabase
          .from('chapter_videos')
          .update({ status: 'failed', error: message.slice(0, 2000) })
          .eq('id', chapterVideoId);
      });

      throw cause;
    }
  },
);
