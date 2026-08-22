import 'server-only';

import { soleOwnedStoryIds } from '@/lib/engine/sole-ownership';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Account deletion (build plan Part 11 tension, launch plan C1.1).
 *
 * Deletion itself is `auth.admin.deleteUser`, which triggers the FK behavior
 * set up in migration 20260824000004: cascades that would destroy other
 * members' collaborative work were changed to `set null`, so a story,
 * universe, draft, or submission survives its owner's account being deleted.
 *
 * What that migration does not solve is governance: `story_members` still
 * cascades a deleted user's own membership row (correctly — a membership is
 * meaningless without the member), and stories_update/stories_delete are
 * gated on is_story_owner(). A story where the deleting user is the *only*
 * owner would be left with no one who can ever manage it again. Rather than
 * auto-promoting someone on the user's behalf, deletion is refused until they
 * transfer ownership themselves — see ownership-transfer.ts.
 */

export interface BlockedStory {
  storyId: string;
  title: string;
}

export class AccountDeletionBlockedError extends Error {
  constructor(readonly stories: BlockedStory[]) {
    super(
      `Account deletion is blocked: you are the sole owner of ${stories.length} ` +
        `${stories.length === 1 ? 'story' : 'stories'}. Transfer ownership before deleting your account.`,
    );
    this.name = 'AccountDeletionBlockedError';
  }
}

async function findSoleOwnedStories(userId: string): Promise<BlockedStory[]> {
  const supabase = createServiceRoleClient();

  const { data: ownedRows, error: ownedError } = await supabase
    .from('story_members')
    .select('story_id')
    .eq('user_id', userId)
    .eq('role', 'owner');

  if (ownedError !== null) {
    throw new Error(`Failed to list owned stories: ${ownedError.message}`);
  }

  const candidateStoryIds = ownedRows.map((row) => row.story_id);
  if (candidateStoryIds.length === 0) {
    return [];
  }

  const { data: ownerRows, error: ownerRowsError } = await supabase
    .from('story_members')
    .select('story_id, user_id')
    .in('story_id', candidateStoryIds)
    .eq('role', 'owner');

  if (ownerRowsError !== null) {
    throw new Error(`Failed to count story owners: ${ownerRowsError.message}`);
  }

  const soleOwnedIds = soleOwnedStoryIds(
    userId,
    ownerRows.map((row) => ({ storyId: row.story_id, userId: row.user_id })),
  );

  if (soleOwnedIds.length === 0) {
    return [];
  }

  const { data: stories, error: titleError } = await supabase
    .from('stories')
    .select('id, title')
    .in('id', soleOwnedIds);

  if (titleError !== null) {
    throw new Error(`Failed to look up story titles: ${titleError.message}`);
  }

  return stories.map((story) => ({ storyId: story.id, title: story.title }));
}

/**
 * Delete the account, or throw AccountDeletionBlockedError naming the stories
 * that must be transferred first.
 *
 * Runs entirely through the service role: `auth.admin.deleteUser` requires
 * the service-role key by design (it is not an operation a user session can
 * perform on itself), and the sole-ownership check reads across every story
 * the user belongs to, which their own RLS-scoped session cannot do in one
 * query for the same reason a member cannot list another member's stories.
 */
export async function deleteAccount(userId: string): Promise<void> {
  const blocked = await findSoleOwnedStories(userId);
  if (blocked.length > 0) {
    throw new AccountDeletionBlockedError(blocked);
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.auth.admin.deleteUser(userId);

  if (error !== null) {
    throw new Error(`Failed to delete account: ${error.message}`);
  }
}
