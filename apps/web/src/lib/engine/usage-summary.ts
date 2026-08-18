import 'server-only';

import { assertMember } from '@/lib/engine/membership';
import { createServiceRoleClient } from '@/lib/supabase/server';

/** Cumulative cost for a story, shown on the story view without extra navigation. */
export async function getStoryCostUsd(storyId: string, userId: string): Promise<number> {
  await assertMember(storyId, userId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('usage_log')
    .select('cost_usd')
    .eq('story_id', storyId);

  if (error !== null) {
    throw new Error(`Failed to read usage: ${error.message}`);
  }

  return data.reduce((sum, row) => sum + row.cost_usd, 0);
}
