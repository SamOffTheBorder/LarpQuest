import 'server-only';

import { callStructured, embedText, StructuredOutputError, EmbeddingError, type BudgetGuard, type UsageRecorder } from '@/lib/ai/gateway';
import type { ModelConfig } from '@/lib/ai/roles';
import { ARC_SUMMARY_SYSTEM_PROMPT, buildArcSummaryPrompt, type ArcChapterSummaryInput } from '@/lib/memory/prompts';
import { arcSummaryResultSchema, type RetrievalBias } from '@/lib/memory/schemas';
import { toVectorLiteral } from '@/lib/memory/generate';
import { resolveStoryApiKey } from '@/lib/ai/api-key';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Arc compaction (build plan Part 6.4).
 *
 * Beyond ~50 chapters, one summary per 10-15 chapter arc keeps distant-history
 * retrieval from growing linearly with story length. Threshold and arc size
 * are hardcoded, not per-universe policy — the build plan gives them as
 * approximate constants, not a tunable (design.md open question).
 */

export const ARC_COMPACTION_THRESHOLD_CHAPTERS = 50;
export const ARC_SIZE_CHAPTERS = 12;

export interface ArcRange {
  fromChapter: number;
  toChapter: number;
}

/**
 * True exactly when `currentTurnNumber` is the chapter that closes an arc
 * past the compaction threshold — pure function of the chapter count, no
 * database read, so it is trivially testable at every boundary.
 */
export function shouldCompactArc(currentTurnNumber: number): ArcRange | null {
  if (currentTurnNumber < ARC_COMPACTION_THRESHOLD_CHAPTERS) {
    return null;
  }

  const chaptersPastThreshold = currentTurnNumber - ARC_COMPACTION_THRESHOLD_CHAPTERS + 1;

  if (chaptersPastThreshold % ARC_SIZE_CHAPTERS !== 0) {
    return null;
  }

  const toChapter = currentTurnNumber;
  const fromChapter = toChapter - ARC_SIZE_CHAPTERS + 1;

  return { fromChapter, toChapter };
}

export type ArcSummaryOutcome =
  | { status: 'complete'; summary: string; embedding: number[] }
  | { status: 'failed'; error: string };

export interface GenerateArcSummaryArgs {
  storyId: string;
  fromChapter: number;
  toChapter: number;
  chapterSummaries: readonly ArcChapterSummaryInput[];
  modelConfig: ModelConfig | null | undefined;
  retrievalBias: RetrievalBias;
  usage: UsageRecorder;
  budget: BudgetGuard;
}

/**
 * Generates and persists one arc summary. Reads chapter summaries as input,
 * never full prose — an arc summary compresses summaries, matching Part 6.4's
 * "retrieve at arc granularity for distant history."
 */
export async function generateArcSummary(args: GenerateArcSummaryArgs): Promise<ArcSummaryOutcome> {
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
      systemPrompt: ARC_SUMMARY_SYSTEM_PROMPT,
      userPrompt: buildArcSummaryPrompt(args.chapterSummaries, args.retrievalBias),
      schema: arcSummaryResultSchema,
      storyId: args.storyId,
    });

    summaryText = result.data.summary;
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      return { status: 'failed', error: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', error: message };
  }

  let embedding: number[];
  try {
    const embedded = await embedText(deps, {
      modelConfig: args.modelConfig,
      text: summaryText,
      storyId: args.storyId,
    });
    embedding = embedded.embedding;
  } catch (error) {
    if (error instanceof EmbeddingError) {
      return { status: 'failed', error: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', error: message };
  }

  const supabase = createServiceRoleClient();
  await supabase.from('arc_summaries').insert({
    story_id: args.storyId,
    from_chapter: args.fromChapter,
    to_chapter: args.toChapter,
    summary: summaryText,
    embedding: toVectorLiteral(embedding),
  });

  return { status: 'complete', summary: summaryText, embedding };
}
