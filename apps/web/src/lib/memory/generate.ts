import 'server-only';

import { callStructured, embedText, StructuredOutputError, EmbeddingError, type BudgetGuard, type UsageRecorder } from '@/lib/ai/gateway';
import type { ModelConfig } from '@/lib/ai/roles';
import { buildChapterSummaryPrompt, CHAPTER_SUMMARY_SYSTEM_PROMPT, type SummaryEntityInput } from '@/lib/memory/prompts';
import { chapterSummarySchema, type RetrievalBias } from '@/lib/memory/schemas';
import { resolveStoryApiKey } from '@/lib/ai/api-key';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * pgvector columns round-trip through PostgREST as their bracketed text form
 * (`"[0.1,0.2,...]"`), not a JSON array — the generated Supabase types type
 * them `string`, matching this.
 */
export function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Chapter memory generation: a structured summary via `summarizer`, then an
 * embedding of that summary (not the prose) via `embedder`.
 *
 * Mirrors research/pipeline.ts's `runStage`: a failure is returned as a typed
 * outcome, never thrown past this function, so the memory worker can mark the
 * job failed and move on rather than crash — memory generation must never be
 * able to affect a chapter's publication state.
 */

export type MemoryOutcome =
  | { status: 'complete'; summary: string; embedding: number[] }
  | { status: 'failed'; error: string };

export interface GenerateChapterMemoryArgs {
  chapterId: string;
  storyId: string;
  turnNumber: number;
  prose: string;
  entities: readonly SummaryEntityInput[];
  modelConfig: ModelConfig | null | undefined;
  retrievalBias: RetrievalBias;
  usage: UsageRecorder;
  budget: BudgetGuard;
}

function formatSummaryText(summary: {
  what_happened: string;
  who_was_involved: string[];
  what_changed: string[];
}): string {
  return [
    summary.what_happened,
    summary.who_was_involved.length > 0 ? `Involved: ${summary.who_was_involved.join(', ')}` : null,
    summary.what_changed.length > 0 ? `Changed: ${summary.what_changed.join('; ')}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join('\n');
}

export async function generateChapterMemory(args: GenerateChapterMemoryArgs): Promise<MemoryOutcome> {
  const deps = {
    apiKey: (await resolveStoryApiKey(args.storyId)).key,
    usage: args.usage,
    budget: args.budget,
  };

  let summaryText: string;
  try {
    const result = await callStructured(deps, {
      role: 'summarizer',
      modelConfig: args.modelConfig,
      systemPrompt: CHAPTER_SUMMARY_SYSTEM_PROMPT,
      userPrompt: buildChapterSummaryPrompt(
        { turnNumber: args.turnNumber, prose: args.prose },
        args.entities,
        args.retrievalBias,
      ),
      schema: chapterSummarySchema,
      storyId: args.storyId,
    });

    summaryText = formatSummaryText(result.data);
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      return { status: 'failed', error: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', error: message };
  }

  try {
    const embedded = await embedText(deps, {
      modelConfig: args.modelConfig,
      text: summaryText,
      storyId: args.storyId,
    });

    return { status: 'complete', summary: summaryText, embedding: embedded.embedding };
  } catch (error) {
    if (error instanceof EmbeddingError) {
      return { status: 'failed', error: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', error: message };
  }
}

/** Persists a completed outcome onto the chapter row. Callers decide status bookkeeping on the queue row. */
export async function persistChapterMemory(chapterId: string, outcome: MemoryOutcome): Promise<void> {
  const supabase = createServiceRoleClient();

  if (outcome.status === 'complete') {
    await supabase
      .from('chapters')
      .update({
        summary: outcome.summary,
        embedding: toVectorLiteral(outcome.embedding),
        memory_status: 'complete',
      })
      .eq('id', chapterId);
    return;
  }

  await supabase.from('chapters').update({ memory_status: 'failed' }).eq('id', chapterId);
}
