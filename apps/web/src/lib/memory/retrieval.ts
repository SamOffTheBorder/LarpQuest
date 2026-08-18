import 'server-only';

import { embedText, type UsageRecorder } from '@/lib/ai/gateway';
import type { ModelConfig } from '@/lib/ai/roles';
import { toVectorLiteral } from '@/lib/memory/generate';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Top-K summary retrieval by vector similarity.
 *
 * One function, no branch on universe, genre, or media type — retrieval_bias
 * only ever shapes the *content* of summaries upstream, when they are
 * generated (memory/prompts.ts), never this function's ranking logic. See
 * the context-assembly spec's "Retrieval respects universe-supplied bias
 * without branching on it."
 *
 * Chapters within the recent window are excluded by the caller
 * (context.ts's dedupe-by-turnNumber), not here — this function always
 * returns its full top-K by similarity, scoped to one story.
 */

export interface RetrievedSummary {
  turnNumber: number;
  arcRange?: { fromChapter: number; toChapter: number };
  summary: string;
  similarity: number;
}

export interface RetrieveRelevantSummariesArgs {
  storyId: string;
  queryText: string;
  k: number;
  modelConfig: ModelConfig | null | undefined;
  usage: UsageRecorder;
}

export async function retrieveRelevantSummaries(
  args: RetrieveRelevantSummariesArgs,
): Promise<RetrievedSummary[]> {
  if (args.k <= 0) {
    return [];
  }

  const { embedding } = await embedText(
    { apiKey: serverEnv().OPENROUTER_API_KEY, usage: args.usage },
    { modelConfig: args.modelConfig, text: args.queryText, storyId: args.storyId },
  );

  const queryEmbedding = toVectorLiteral(embedding);
  const supabase = createServiceRoleClient();

  const [chapterMatches, arcMatches] = await Promise.all([
    supabase.rpc('match_chapter_summaries', {
      p_story_id: args.storyId,
      p_query_embedding: queryEmbedding,
      p_match_count: args.k,
    }),
    supabase.rpc('match_arc_summaries', {
      p_story_id: args.storyId,
      p_query_embedding: queryEmbedding,
      p_match_count: args.k,
    }),
  ]);

  if (chapterMatches.error !== null) {
    throw new Error(`Failed to match chapter summaries: ${chapterMatches.error.message}`);
  }

  if (arcMatches.error !== null) {
    throw new Error(`Failed to match arc summaries: ${arcMatches.error.message}`);
  }

  const chapterResults: RetrievedSummary[] = chapterMatches.data.map((row) => ({
    turnNumber: row.turn_number,
    summary: row.summary,
    similarity: row.similarity,
  }));

  const arcResults: RetrievedSummary[] = arcMatches.data.map((row) => ({
    turnNumber: row.to_chapter,
    arcRange: { fromChapter: row.from_chapter, toChapter: row.to_chapter },
    summary: row.summary,
    similarity: row.similarity,
  }));

  return [...chapterResults, ...arcResults]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, args.k);
}
