import 'server-only';

import { z } from 'zod';

import { callStructured, StructuredOutputError } from '@/lib/ai/gateway';
import { createBudgetGuard } from '@/lib/ai/spend';
import { createUsageRecorder } from '@/lib/ai/usage';
import { queueChapterIllustration } from '@/lib/engine/chapter-illustration';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * Image prompt generation.
 *
 * Runs strictly after publication via `image_prompt_queue`, populated by
 * `publish_chapter` alongside `extraction_queue`/`memory_queue`. Nothing here
 * can affect publication: this worker only ever runs later, out of band,
 * against a chapter that already exists and is already readable — same
 * never-block-publication discipline as extraction.
 *
 * The system prompt derives its visual description entirely from the
 * chapter's prose and the entities it touched — no hardcoded reference to any
 * genre, universe, or media type. A universe with a power-system schema and
 * one with none go through the identical code path.
 */

export const IMAGE_PROMPT_SYSTEM_PROMPT = [
  'You write image-generation prompts for a manga-style illustrator, based on',
  'a chapter of a story.',
  '',
  'You will be given the chapter text and the entities it involves. Identify',
  "the chapter's single most visually striking moment — or, if the chapter",
  'clearly spans more than one distinct scene worth illustrating, up to three',
  '— and write one concrete, visual image-generation prompt per moment.',
  '',
  'Rules:',
  '- Describe only what is visually present: setting, characters, action,',
  '  mood, lighting. Do not describe abstract plot or internal thoughts.',
  '- Use the entity names and descriptions you were given so a character',
  "  reads consistently across chapters — but never invent a universe's",
  '  vocabulary; describe only what this specific story already established.',
  '- Each prompt should stand alone: a reader with no other context should be',
  '  able to picture the scene from the prompt text.',
  '- Produce between 1 and 3 prompts.',
  '',
  'Respond with JSON only: {"prompts": ["...", ...]}',
].join('\n');

export interface ImagePromptEntityContext {
  id: string;
  type: string;
  name: string;
  data: Record<string, unknown>;
}

export interface BuildImagePromptArgs {
  chapterProse: string;
  entities: readonly ImagePromptEntityContext[];
}

export const imagePromptResultSchema = z.object({
  prompts: z.array(z.string().min(1)).min(1).max(3),
});

export type ImagePromptResult = z.infer<typeof imagePromptResultSchema>;

function renderEntity(entity: ImagePromptEntityContext): string {
  return `- ${entity.name} (${entity.type}): ${JSON.stringify(entity.data)}`;
}

export function buildImagePromptUserPrompt(args: BuildImagePromptArgs): string {
  const entitySection =
    args.entities.length > 0 ? args.entities.map(renderEntity).join('\n') : '(no entities in this story yet)';

  return [
    `## Chapter\n${args.chapterProse}`,
    `## Entities\n${entitySection}`,
    'Write image-generation prompts for this chapter.',
  ].join('\n\n');
}

export interface ImagePromptOutcome {
  claimed: boolean;
  chapterId?: string;
  promptCount?: number;
}

/**
 * Claim and process a single job. Returns `{ claimed: false }` when the queue
 * was empty — callers loop this to drain the queue, or call it once per
 * scheduled invocation, same shape as `runOneExtraction`.
 */
export async function runOneImagePromptGeneration(staleAfterMinutes = 5): Promise<ImagePromptOutcome> {
  const supabase = createServiceRoleClient();

  const { data: job, error: claimError } = await supabase.rpc('claim_image_prompt_job', {
    stale_after: `${staleAfterMinutes} minutes`,
  });

  if (claimError !== null) {
    throw new Error(`Failed to claim image prompt job: ${claimError.message}`);
  }

  if (job === null) {
    return { claimed: false };
  }

  try {
    const prompts = await generatePrompts(job.chapter_id, job.story_id);

    await supabase.from('image_prompt_queue').update({ status: 'complete' }).eq('id', job.id);
    await supabase.from('chapters').update({ image_prompts: toJson(prompts) }).eq('id', job.chapter_id);

    // Illustration is a separate, independently-failing step. Prompt
    // generation has already succeeded and been recorded above by this
    // point — a failure queuing illustration must never retroactively mark
    // this (already-successful) prompt job as failed, so it is caught and
    // logged here rather than left to the outer catch.
    try {
      await queueChapterIllustration(job.chapter_id, job.story_id, prompts);
    } catch (illustrationCause) {
      console.error('chapter illustration queueing failed', {
        chapterId: job.chapter_id,
        storyId: job.story_id,
        message: illustrationCause instanceof Error ? illustrationCause.message : String(illustrationCause),
      });
    }

    return { claimed: true, chapterId: job.chapter_id, promptCount: prompts.length };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    // Only the queue row records the failure. chapters.image_prompts is left
    // untouched — publication and every other chapter field are unreachable
    // from this path, exactly like extraction-worker's failure handling.
    await supabase
      .from('image_prompt_queue')
      .update({ status: 'failed', last_error: message.slice(0, 2000) })
      .eq('id', job.id);

    throw cause;
  }
}

async function generatePrompts(chapterId: string, storyId: string): Promise<string[]> {
  const supabase = createServiceRoleClient();

  const [chapterResult, storyResult, entityResult] = await Promise.all([
    supabase.from('chapters').select('prose, entity_ids').eq('id', chapterId).single(),
    supabase.from('stories').select('model_config').eq('id', storyId).single(),
    supabase.from('entities').select('id, type, name, data').eq('story_id', storyId),
  ]);

  if (chapterResult.error !== null) {
    throw new Error(`Failed to read chapter: ${chapterResult.error.message}`);
  }

  if (storyResult.error !== null) {
    throw new Error(`Failed to read story: ${storyResult.error.message}`);
  }

  if (entityResult.error !== null) {
    throw new Error(`Failed to read entities: ${entityResult.error.message}`);
  }

  const touchedIds = new Set(chapterResult.data.entity_ids ?? []);
  const entities = entityResult.data
    .filter((row) => touchedIds.size === 0 || touchedIds.has(row.id))
    .map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      data: (row.data ?? {}) as Record<string, unknown>,
    }));

  const userPrompt = buildImagePromptUserPrompt({ chapterProse: chapterResult.data.prose, entities });

  try {
    const result = await callStructured(
      {
        apiKey: serverEnv().OPENROUTER_API_KEY,
        usage: createUsageRecorder(storyId, null),
        budget: createBudgetGuard(storyId, null),
      },
      {
        role: 'illustrator',
        modelConfig: storyResult.data.model_config as never,
        systemPrompt: IMAGE_PROMPT_SYSTEM_PROMPT,
        userPrompt,
        schema: imagePromptResultSchema,
        storyId,
      },
    );

    return result.data.prompts;
  } catch (cause) {
    if (cause instanceof StructuredOutputError) {
      throw new Error(`Illustrator returned unparseable output: ${cause.message}`);
    }
    throw cause;
  }
}
