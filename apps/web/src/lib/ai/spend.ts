import 'server-only';

import {
  checkBudget,
  SpendCapExceededError,
  type SpendSnapshot,
} from '@/lib/ai/budget';
import type { BudgetGuard } from '@/lib/ai/gateway';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * The real BudgetGuard: reads spend and caps, then applies the policy in
 * `budget.ts`.
 *
 * Unlike the UsageRecorder — whose failures are swallowed, because losing a
 * generated chapter over a missing cost row would be worse than losing the row
 * — a failure here **refuses the call**. The whole point of a hard stop is
 * that it cannot be bypassed by making the check fail, and a database that
 * cannot answer "how much has this spent?" is not a database we should be
 * spending against.
 */
export function createBudgetGuard(
  storyId: string | null,
  userId: string | null,
): BudgetGuard {
  return {
    async assertWithinBudget() {
      const supabase = createServiceRoleClient();

      const { data: spend, error: spendError } = await supabase
        .rpc('spend_to_date', { target_story_id: storyId, target_user_id: userId })
        .single();

      if (spendError !== null) {
        throw new Error(`Spend cap check failed: ${spendError.message}`);
      }

      const snapshot: SpendSnapshot = {
        storySpendUsd: Number(spend.story_spend_usd),
        userSpendUsd: Number(spend.user_spend_usd),
        storyCapUsd: await readStoryCap(supabase, storyId),
        userCapUsd: await readUserCap(supabase, userId),
      };

      const verdict = checkBudget(snapshot);

      if (!verdict.allowed) {
        throw new SpendCapExceededError(
          verdict.exceeded!,
          verdict.spentUsd!,
          verdict.capUsd!,
        );
      }
    },
  };
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

async function readStoryCap(supabase: ServiceClient, storyId: string | null) {
  if (storyId === null) {
    return null;
  }

  const { data, error } = await supabase
    .from('stories')
    .select('spend_cap_usd')
    .eq('id', storyId)
    .single();

  if (error !== null) {
    throw new Error(`Spend cap lookup failed for story: ${error.message}`);
  }

  return data.spend_cap_usd === null ? null : Number(data.spend_cap_usd);
}

async function readUserCap(supabase: ServiceClient, userId: string | null) {
  if (userId === null) {
    return null;
  }

  const { data, error } = await supabase
    .from('user_preferences')
    .select('spend_cap_usd')
    .eq('user_id', userId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Spend cap lookup failed for user: ${error.message}`);
  }

  // No preferences row is normal — a user who never opened settings has one
  // created lazily. Absent means "no cap of their own", not "cap of zero".
  return data?.spend_cap_usd == null ? null : Number(data.spend_cap_usd);
}

/**
 * Enforces nothing. For code paths with no story or user to attribute spend
 * to, mirroring `nullUsageRecorder`. Use sparingly — an unattributed model
 * call is an uncapped one.
 */
export const nullBudgetGuard: BudgetGuard = {
  async assertWithinBudget() {
    // Intentionally empty.
  },
};
