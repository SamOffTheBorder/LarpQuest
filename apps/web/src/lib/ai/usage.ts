import 'server-only';

import type { UsageRecorder } from '@/lib/ai/gateway';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The real UsageRecorder: writes a `usage_log` row per model call.
 *
 * A failed recording must never take down the call that produced it. Usage
 * accounting is important, but losing a generated chapter because its cost row
 * could not be written would be worse — so failures here are logged and
 * swallowed rather than thrown.
 */
export function createUsageRecorder(
  storyId: string | null,
  userId: string | null,
): UsageRecorder {
  return {
    async record(entry) {
      const supabase = createServiceRoleClient();

      const { error } = await supabase.from('usage_log').insert({
        story_id: storyId,
        user_id: userId,
        role: entry.role,
        model: entry.model,
        prompt_tokens: entry.promptTokens,
        completion_tokens: entry.completionTokens,
        cost_usd: entry.costUsd,
        succeeded: entry.succeeded,
        used_fallback_model: entry.usedFallbackModel,
      });

      if (error !== null) {
        console.error('usage_log insert failed', {
          storyId,
          role: entry.role,
          model: entry.model,
          message: error.message,
        });
      }
    },
  };
}

/** Records nothing. For code paths where no story context exists yet. */
export const nullUsageRecorder: UsageRecorder = {
  async record() {
    // Intentionally empty.
  },
};
