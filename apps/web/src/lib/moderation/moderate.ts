import 'server-only';

import { callStructured, StructuredOutputError, type UsageRecorder } from '@/lib/ai/gateway';
import type { ModelConfig } from '@/lib/ai/roles';
import { createUsageRecorder } from '@/lib/ai/usage';
import { moderationResultSchema, type ModerationResult } from '@/lib/moderation/schemas';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Submission-level moderation pass, run once per turn at lock time — before
 * a locked turn's submissions reach context assembly and, from there, other
 * players (build plan 7.5). `callStructured` already retries once internally
 * with the parse error appended (CLAUDE.md #7); a second failure here is
 * treated as `flag`, not thrown, so a broken auxiliary system never blocks
 * the core turn loop — the same "never let auxiliary failure stop the main
 * path" principle CLAUDE.md states for extraction.
 */

const MODERATOR_SYSTEM_PROMPT = [
  'You are a content moderator for a collaborative fiction platform.',
  '',
  'You will be given the story\'s content rating and the player submissions',
  'for one turn. Decide whether the submitted content is appropriate to pass',
  'to the narrator and, from there, to the other players in this shared room.',
  '',
  '- "pass": nothing concerning.',
  '- "flag": borderline or concerning content that should still be narrated,',
  '  but a GM should be able to review it afterward.',
  '- "block": content that must not reach the narrator or other players —',
  '  e.g. content clearly outside the story\'s content rating, or content one',
  '  player is steering the story into that another player did not consent to.',
  '',
  'Always give a short, specific reason for your verdict.',
].join('\n');

export interface ModerationOutcome extends ModerationResult {
  /** True when the model call itself failed and this outcome is the fail-open default. */
  degraded: boolean;
}

const FAIL_OPEN_OUTCOME = (reason: string): ModerationOutcome => ({
  verdict: 'flag',
  reason,
  degraded: true,
});

export async function moderateTurnSubmissions(
  turnId: string,
  contentRating: string,
  modelConfig: ModelConfig | null,
  storyId: string,
  usage: UsageRecorder = createUsageRecorder(storyId, null),
): Promise<ModerationOutcome> {
  const supabase = createServiceRoleClient();
  const { data: submissions, error } = await supabase
    .from('submissions')
    .select('content')
    .eq('turn_id', turnId)
    .order('submitted_at');

  if (error !== null) {
    throw new Error(`Failed to read submissions for moderation: ${error.message}`);
  }

  if (submissions.length === 0) {
    return { verdict: 'pass', reason: 'No submissions to moderate.', degraded: false };
  }

  const userPrompt = [
    `Content rating: ${contentRating}`,
    '',
    'Submissions this turn:',
    ...submissions.map((row, index) => `${index + 1}. ${row.content}`),
  ].join('\n');

  try {
    const result = await callStructured(
      { apiKey: serverEnv().OPENROUTER_API_KEY, usage },
      {
        role: 'moderator',
        modelConfig,
        systemPrompt: MODERATOR_SYSTEM_PROMPT,
        userPrompt,
        schema: moderationResultSchema,
        storyId,
      },
    );

    return { ...result.data, degraded: false };
  } catch (cause) {
    if (cause instanceof StructuredOutputError) {
      return FAIL_OPEN_OUTCOME(`Moderator call failed after retry: ${cause.message}`);
    }

    throw cause;
  }
}
