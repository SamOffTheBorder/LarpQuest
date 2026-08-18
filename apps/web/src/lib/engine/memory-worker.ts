import 'server-only';

import { createUsageRecorder } from '@/lib/ai/usage';
import { shouldCompactArc, generateArcSummary } from '@/lib/memory/arc-compaction';
import { generateChapterMemory, persistChapterMemory } from '@/lib/memory/generate';
import { DEFAULT_CONTEXT_POLICY, type RetrievalBias } from '@/lib/memory/schemas';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The memory worker.
 *
 * Runs strictly after publication, same guarantee as the extraction worker:
 * nothing here can affect `chapters.prose`, `published_at`, or `turn_id` — a
 * chapter is published the moment `publish_chapter` commits, and this only
 * ever runs later, out of band, against a chapter that already exists.
 *
 * A failure here ends with the `memory_queue` row marked `failed` (or left
 * `claimed` for stale-claim recovery) and `chapters.memory_status` set to
 * `failed`. The chapter itself is never touched beyond that field.
 *
 * After a successful chapter memory job, this also checks whether the
 * story's chapter count just closed an arc boundary (Part 6.4) and, if so,
 * generates that arc's summary inline — arc compaction piggybacks on the
 * per-chapter worker rather than needing a separate scheduled sweep
 * (design.md decision 6).
 */

export interface MemoryWorkerOutcome {
  claimed: boolean;
  chapterId?: string;
  memoryStatus?: 'complete' | 'failed';
  arcCompacted?: boolean;
}

export async function runOneMemoryJob(staleAfterMinutes = 5): Promise<MemoryWorkerOutcome> {
  const supabase = createServiceRoleClient();

  const { data: job, error: claimError } = await supabase.rpc('claim_memory_job', {
    stale_after: `${staleAfterMinutes} minutes`,
  });

  if (claimError !== null) {
    throw new Error(`Failed to claim memory job: ${claimError.message}`);
  }

  if (job === null) {
    return { claimed: false };
  }

  try {
    const outcome = await generateAndCompact(job.chapter_id, job.story_id);

    await supabase
      .from('memory_queue')
      .update({ status: outcome.memoryStatus === 'complete' ? 'complete' : 'failed' })
      .eq('id', job.id);

    return { claimed: true, chapterId: job.chapter_id, ...outcome };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    await supabase
      .from('memory_queue')
      .update({ status: 'failed', last_error: message.slice(0, 2000) })
      .eq('id', job.id);

    await supabase.from('chapters').update({ memory_status: 'failed' }).eq('id', job.chapter_id);

    throw cause;
  }
}

interface GenerateAndCompactResult {
  memoryStatus: 'complete' | 'failed';
  arcCompacted: boolean;
}

async function generateAndCompact(chapterId: string, storyId: string): Promise<GenerateAndCompactResult> {
  const supabase = createServiceRoleClient();

  const [chapterResult, storyResult, entityResult] = await Promise.all([
    supabase.from('chapters').select('turn_number, prose').eq('id', chapterId).single(),
    supabase
      .from('stories')
      .select('model_config, current_turn, universe_id, universe_version')
      .eq('id', storyId)
      .single(),
    supabase.from('entities').select('name, type').eq('story_id', storyId),
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

  const retrievalBias = await resolveRetrievalBias(
    storyResult.data.universe_id as string | null,
    storyResult.data.universe_version as number | null,
  );

  const memoryOutcome = await generateChapterMemory({
    chapterId,
    storyId,
    turnNumber: chapterResult.data.turn_number,
    prose: chapterResult.data.prose,
    entities: entityResult.data,
    modelConfig: storyResult.data.model_config as never,
    retrievalBias,
    usage: createUsageRecorder(storyId, null),
  });

  await persistChapterMemory(chapterId, memoryOutcome);

  if (memoryOutcome.status !== 'complete') {
    return { memoryStatus: 'failed', arcCompacted: false };
  }

  const arcRange = shouldCompactArc(storyResult.data.current_turn);

  if (arcRange === null) {
    return { memoryStatus: 'complete', arcCompacted: false };
  }

  const { data: arcChapters, error: arcChaptersError } = await supabase
    .from('chapters')
    .select('turn_number, summary')
    .eq('story_id', storyId)
    .gte('turn_number', arcRange.fromChapter)
    .lte('turn_number', arcRange.toChapter)
    .order('turn_number', { ascending: true });

  if (arcChaptersError !== null) {
    throw new Error(`Failed to read arc chapters: ${arcChaptersError.message}`);
  }

  const chapterSummaries = arcChapters
    .filter((row): row is { turn_number: number; summary: string } => row.summary !== null)
    .map((row) => ({ turnNumber: row.turn_number, summary: row.summary }));

  const arcOutcome = await generateArcSummary({
    storyId,
    fromChapter: arcRange.fromChapter,
    toChapter: arcRange.toChapter,
    chapterSummaries,
    modelConfig: storyResult.data.model_config as never,
    retrievalBias,
    usage: createUsageRecorder(storyId, null),
  });

  // Arc-summary failure never turns the chapter's own memory job into a
  // failure — the chapter's summary/embedding are already persisted above.
  return { memoryStatus: 'complete', arcCompacted: arcOutcome.status === 'complete' };
}

async function resolveRetrievalBias(
  universeId: string | null,
  universeVersion: number | null,
): Promise<RetrievalBias> {
  if (universeId === null || universeVersion === null) {
    return DEFAULT_CONTEXT_POLICY.retrieval_bias;
  }

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('universe_versions')
    .select('context_policy')
    .eq('universe_id', universeId)
    .eq('version', universeVersion)
    .single();

  const policy = data?.context_policy as { retrieval_bias?: RetrievalBias } | null;
  return policy?.retrieval_bias ?? DEFAULT_CONTEXT_POLICY.retrieval_bias;
}
