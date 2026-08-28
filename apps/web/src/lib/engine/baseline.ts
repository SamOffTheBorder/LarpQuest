import 'server-only';

import { streamNarration } from '@/lib/ai/gateway';
import { createBudgetGuard } from '@/lib/ai/spend';
import { untrustedSections } from '@/lib/ai/untrusted';
import { nullUsageRecorder } from '@/lib/ai/usage';
import { assertMember } from '@/lib/engine/membership';
import { resolveTurnMode } from '@/lib/engine/turn-modes';
import { resolveStoryApiKey } from '@/lib/ai/api-key';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The no-state baseline (task 10.4 / Appendix B).
 *
 * Regenerates a chapter using only concatenated prior prose as context — no
 * entity state, no world ledger, no structured anything, the way a plain
 * chat-with-memory bot would do it. This exists purely to compare against the
 * real, state-assembled chapter and demonstrate (or fail to demonstrate) that
 * structured context actually produces better long-story consistency. It is
 * read-only: nothing here writes a chapter, advances a turn, or touches
 * entity_history. Never called from the main turn loop.
 */

export interface BaselineComparison {
  turnNumber: number;
  realProse: string;
  baselineProse: string;
}

interface ChapterRow {
  turn_number: number;
  prose: string;
}

/**
 * Regenerate chapter `turnNumber` for a story using only prior chapters'
 * prose as context, and return it alongside the real chapter that was
 * actually published for that turn.
 */
export async function generateBaseline(
  storyId: string,
  userId: string,
  turnNumber: number,
): Promise<BaselineComparison> {
  await assertMember(storyId, userId);

  const supabase = createServiceRoleClient();

  const [storyResult, chaptersResult, submissionsResult] = await Promise.all([
    supabase
      .from('stories')
      .select('title, model_config, content_rating, conflict_policy')
      .eq('id', storyId)
      .single(),
    supabase
      .from('chapters')
      .select('turn_number, prose, turn_mode')
      .eq('story_id', storyId)
      .lte('turn_number', turnNumber)
      .order('turn_number', { ascending: true }),
    supabase
      .from('submissions')
      .select('content, turns!inner(turn_number)')
      .eq('story_id', storyId),
  ]);

  if (storyResult.error !== null) {
    throw new Error(`Failed to read story: ${storyResult.error.message}`);
  }

  if (chaptersResult.error !== null) {
    throw new Error(`Failed to read chapters: ${chaptersResult.error.message}`);
  }

  if (submissionsResult.error !== null) {
    throw new Error(`Failed to read submissions: ${submissionsResult.error.message}`);
  }

  const chapters = chaptersResult.data as (ChapterRow & { turn_mode: string })[];
  const targetChapter = chapters.find((chapter) => chapter.turn_number === turnNumber);

  if (targetChapter === undefined) {
    throw new Error(`Story ${storyId} has no published chapter for turn ${turnNumber}.`);
  }

  const priorChapters = chapters.filter((chapter) => chapter.turn_number < turnNumber);

  const submissionsForTurn = (
    submissionsResult.data as { content: string; turns: { turn_number: number } }[]
  )
    .filter((row) => row.turns.turn_number === turnNumber)
    .map((row) => row.content);

  const mode = resolveTurnMode(targetChapter.turn_mode);

  // Deliberately minimal: raw prose concatenation and nothing else. No entity
  // state, no world ledger, no tone directives — the exact absence this test
  // exists to measure the effect of.
  const baselinePrompt = [
    untrustedSections([
      { heading: 'Story', untrusted: storyResult.data.title },
      priorChapters.length > 0
        ? {
            heading: 'Previous chapters',
            untrusted: priorChapters
              .map((c) => `Chapter ${c.turn_number}:\n${c.prose}`)
              .join('\n\n'),
          }
        : { heading: 'Previous chapters', trusted: '(this is the first chapter)' },
      submissionsForTurn.length > 0
        ? { heading: 'Player actions this turn', untrusted: submissionsForTurn.join('\n') }
        : { heading: 'Player actions this turn', trusted: '(none recorded)' },
    ]),
    'Write the next chapter.',
  ].join('\n\n');

  const result = await streamNarration(
    {
      apiKey: (await resolveStoryApiKey(storyId)).key,
      // Deliberately unlogged (this comparison should not distort the story's
      // cost stats) but still capped: it is a real, user-triggerable call
      // against the same budget.
      usage: nullUsageRecorder,
      budget: createBudgetGuard(storyId, userId),
    },
    {
      modelConfig: storyResult.data.model_config as never,
      systemPrompt: mode.systemPrompt({
        contentRating: storyResult.data.content_rating,
        conflictPolicy: storyResult.data.conflict_policy,
      }),
      userPrompt: baselinePrompt,
      onChunk: () => {
        // No live progress needed for a one-off comparison generation.
      },
    },
  );

  return {
    turnNumber,
    realProse: targetChapter.prose,
    baselineProse: result.prose,
  };
}
