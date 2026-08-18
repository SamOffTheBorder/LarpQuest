import 'server-only';

import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Membership checks for service-role code paths.
 *
 * The service-role client bypasses RLS entirely, so every engine function that
 * uses it must check membership itself — RLS will not do it here. This module
 * is that check. Engine code uses the service role because it writes on behalf
 * of the story (generated chapters, extracted diffs) rather than as one user,
 * which is exactly the case RLS cannot express.
 */

export class NotAMemberError extends Error {
  constructor(
    readonly storyId: string,
    readonly userId: string,
  ) {
    // Deliberately does not distinguish "story does not exist" from "you are
    // not a member": both are the same to a caller who should not see it.
    super(`Story ${storyId} not found or not accessible.`);
    this.name = 'NotAMemberError';
  }
}

export async function isMember(storyId: string, userId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('story_members')
    .select('user_id')
    .eq('story_id', storyId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to check story membership: ${error.message}`);
  }

  return data !== null;
}

/** Throws unless the user is a member of the story. */
export async function assertMember(storyId: string, userId: string): Promise<void> {
  if (!(await isMember(storyId, userId))) {
    throw new NotAMemberError(storyId, userId);
  }
}

export async function isOwner(storyId: string, userId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('story_members')
    .select('user_id')
    .eq('story_id', storyId)
    .eq('user_id', userId)
    .eq('role', 'owner')
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to check story ownership: ${error.message}`);
  }

  return data !== null;
}

/** Throws unless the user owns the story. Same not-found shape as assertMember. */
export async function assertOwner(storyId: string, userId: string): Promise<void> {
  if (!(await isOwner(storyId, userId))) {
    throw new NotAMemberError(storyId, userId);
  }
}
