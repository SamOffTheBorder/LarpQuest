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

export type StoryRole = 'owner' | 'gm' | 'player' | 'spectator';

export interface StoryMember {
  userId: string;
  role: StoryRole;
  joinedAt: string;
}

/** List a story's members. Membership is checked before any read. */
export async function listMembers(storyId: string, userId: string): Promise<StoryMember[]> {
  await assertMember(storyId, userId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('story_members')
    .select('user_id, role, joined_at')
    .eq('story_id', storyId)
    .order('joined_at');

  if (error !== null) {
    throw new Error(`Failed to list story members: ${error.message}`);
  }

  return data.map((row) => ({
    userId: row.user_id,
    role: row.role as StoryRole,
    joinedAt: row.joined_at,
  }));
}

export function isGM(role: string): boolean {
  return role === 'gm';
}

export function hasRole(role: string, allowed: readonly StoryRole[]): boolean {
  return (allowed as readonly string[]).includes(role);
}

export class InsufficientRoleError extends Error {
  constructor(
    readonly storyId: string,
    readonly userId: string,
    readonly allowed: readonly StoryRole[],
  ) {
    super(`User ${userId} does not hold one of the required roles [${allowed.join(', ')}] in story ${storyId}.`);
    this.name = 'InsufficientRoleError';
  }
}

async function getRole(storyId: string, userId: string): Promise<string | null> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('story_members')
    .select('role')
    .eq('story_id', storyId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read story role: ${error.message}`);
  }

  return data?.role ?? null;
}

/**
 * Throws unless the user holds one of the allowed roles in the story. A user
 * who is not a member at all is treated the same as one whose role is not
 * allowed — both raise InsufficientRoleError, matching NotAMemberError's
 * "don't reveal what you can't act on" shape.
 */
export async function requireRole(
  storyId: string,
  userId: string,
  allowed: readonly StoryRole[],
): Promise<void> {
  const role = await getRole(storyId, userId);

  if (role === null || !hasRole(role, allowed)) {
    throw new InsufficientRoleError(storyId, userId, allowed);
  }
}

/**
 * Remove a member from a story. Owner/GM only, and the owner can never be
 * removed. Entities the removed user controlled become unclaimed rather than
 * left referencing a former member — a GM can reassign or narrate them out.
 */
export async function removeMember(
  storyId: string,
  actingUserId: string,
  targetUserId: string,
): Promise<void> {
  await requireRole(storyId, actingUserId, ['owner', 'gm']);

  const targetRole = await getRole(storyId, targetUserId);

  if (targetRole === 'owner') {
    throw new Error('The story owner cannot be removed.');
  }

  const supabase = createServiceRoleClient();

  const { error: entityError } = await supabase
    .from('entities')
    .update({ controlled_by: null })
    .eq('story_id', storyId)
    .eq('controlled_by', targetUserId);

  if (entityError !== null) {
    throw new Error(`Failed to release removed member's entities: ${entityError.message}`);
  }

  const { error: deleteError } = await supabase
    .from('story_members')
    .delete()
    .eq('story_id', storyId)
    .eq('user_id', targetUserId);

  if (deleteError !== null) {
    throw new Error(`Failed to remove member: ${deleteError.message}`);
  }
}
