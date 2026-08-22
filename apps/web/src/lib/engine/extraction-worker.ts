import 'server-only';

import { callStructured, StructuredOutputError } from '@/lib/ai/gateway';
import { createBudgetGuard } from '@/lib/ai/spend';
import { createUsageRecorder } from '@/lib/ai/usage';
import { applyDiffs, extractionResultSchema } from '@/lib/engine/diff';
import { buildExtractorPrompt, EXTRACTOR_SYSTEM_PROMPT } from '@/lib/engine/extractor';
import { resolveTurnMode } from '@/lib/engine/turn-modes';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * The extraction worker.
 *
 * Runs strictly after publication and can never affect it: a chapter is
 * published the moment `publish_chapter` commits, and nothing here can
 * un-publish it, block it, or delay it — this worker only ever runs later, out
 * of band, against a chapter that already exists and is already readable.
 *
 * A failure here — a bad extractor response, a database error, a crash — ends
 * with the queue row marked `failed` (or left `claimed` for stale-claim
 * recovery to pick back up) and the chapter's `extraction_status` set to
 * `failed`. The chapter itself is never touched beyond that status field.
 */

export interface ExtractionOutcome {
  claimed: boolean;
  chapterId?: string;
  applied: number;
  rejected: number;
}

/**
 * Claim and process a single job. Returns `{ claimed: false }` when the queue
 * was empty — callers loop this to drain the queue, or call it once per
 * scheduled invocation.
 */
export async function runOneExtraction(staleAfterMinutes = 5): Promise<ExtractionOutcome> {
  const supabase = createServiceRoleClient();

  const { data: job, error: claimError } = await supabase.rpc('claim_extraction_job', {
    stale_after: `${staleAfterMinutes} minutes`,
  });

  if (claimError !== null) {
    throw new Error(`Failed to claim extraction job: ${claimError.message}`);
  }

  if (job === null) {
    return { claimed: false, applied: 0, rejected: 0 };
  }

  try {
    const result = await extractAndApply(job.chapter_id, job.story_id);

    await supabase.from('extraction_queue').update({ status: 'complete' }).eq('id', job.id);
    await supabase
      .from('chapters')
      .update({ extraction_status: 'complete', extracted_diffs: toJson(result.diffs) })
      .eq('id', job.chapter_id);

    return {
      claimed: true,
      chapterId: job.chapter_id,
      applied: result.applied,
      rejected: result.rejected,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    // The queue row records the failure for observability and retry
    // bookkeeping; the chapter's extraction_status is what the UI reads.
    // Neither write touches prose, published_at, or turn_id — publication is
    // not reachable from this path.
    await supabase
      .from('extraction_queue')
      .update({ status: 'failed', last_error: message.slice(0, 2000) })
      .eq('id', job.id);

    await supabase.from('chapters').update({ extraction_status: 'failed' }).eq('id', job.chapter_id);

    throw cause;
  }
}

interface ExtractAndApplyResult {
  applied: number;
  rejected: number;
  diffs: unknown;
}

async function extractAndApply(chapterId: string, storyId: string): Promise<ExtractAndApplyResult> {
  const supabase = createServiceRoleClient();

  const [chapterResult, storyResult, entityResult] = await Promise.all([
    supabase.from('chapters').select('prose, turn_mode').eq('id', chapterId).single(),
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

  const mode = resolveTurnMode(chapterResult.data.turn_mode);
  const entities = entityResult.data.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    data: (row.data ?? {}) as Record<string, unknown>,
  }));

  const prompt = buildExtractorPrompt({
    chapterProse: chapterResult.data.prose,
    entities,
    extractionTargets: mode.extractionTargets,
  });

  let extraction;
  try {
    extraction = await callStructured(
      {
        apiKey: serverEnv().OPENROUTER_API_KEY,
        usage: createUsageRecorder(storyId, null),
        budget: createBudgetGuard(storyId, null),
      },
      {
        role: 'extractor',
        modelConfig: storyResult.data.model_config as never,
        systemPrompt: EXTRACTOR_SYSTEM_PROMPT,
        userPrompt: prompt,
        schema: extractionResultSchema,
        storyId,
      },
    );
  } catch (cause) {
    if (cause instanceof StructuredOutputError) {
      throw new Error(`Extractor returned unparseable output: ${cause.message}`);
    }
    throw cause;
  }

  const entityMap = new Map(entities.map((entity) => [entity.id, entity.data]));
  const result = applyDiffs(entityMap, extraction.data.diffs);

  // Persist each applied diff through the same atomic update+history path
  // manual edits use, so entity_history has one shape regardless of origin.
  for (const applied of result.applied) {
    const nextData = result.updated.get(applied.diff.entity_id);

    if (nextData === undefined) {
      continue;
    }

    const { error } = await supabase.rpc('apply_entity_update', {
      p_entity_id: applied.diff.entity_id,
      p_data: toJson(nextData),
      p_diff: toJson(applied.diff),
      p_chapter_id: chapterId,
      p_is_reversal: false,
    });

    if (error !== null) {
      throw new Error(`Failed to apply extracted diff: ${error.message}`);
    }
  }

  return {
    applied: result.applied.length,
    rejected: result.rejected.length,
    diffs: extraction.data.diffs,
  };
}
