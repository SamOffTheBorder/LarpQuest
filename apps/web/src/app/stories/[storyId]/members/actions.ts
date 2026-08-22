'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { createInvite, inviteRoleSchema, joinViaInvite, revokeInvite } from '@/lib/engine/invites';
import { assertWithinRateLimit, RateLimitExceededError } from '@/lib/rate-limit';
import { removeMember } from '@/lib/engine/membership';
import { transferStoryOwnership } from '@/lib/engine/ownership-transfer';

export type MemberActionState = {
  status: 'idle' | 'error';
  message?: string;
};

const initialIdle: MemberActionState = { status: 'idle' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export async function createInviteAction(
  storyId: string,
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const user = await requireUser();

  const parsedRole = inviteRoleSchema.safeParse(formData.get('role'));
  if (!parsedRole.success) {
    return { status: 'error', message: 'Choose a role to invite.' };
  }

  try {
    await assertWithinRateLimit('invite_create', user.id);
    await createInvite(storyId, user.id, { role: parsedRole.data, expiresInDays: 7, maxUses: null });
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/members`);
  return initialIdle;
}

export async function revokeInviteAction(storyId: string, inviteId: string): Promise<MemberActionState> {
  const user = await requireUser();

  try {
    await revokeInvite(inviteId, user.id);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/members`);
  return initialIdle;
}

export async function removeMemberAction(storyId: string, targetUserId: string): Promise<MemberActionState> {
  const user = await requireUser();

  try {
    await removeMember(storyId, user.id, targetUserId);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/members`);
  return initialIdle;
}

/** Returns the joined story's id on success, so the caller can redirect. */
export async function joinStoryAction(
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState & { storyId?: string }> {
  await requireUser();

  const token = formData.get('token');
  if (typeof token !== 'string' || token.trim().length === 0) {
    return { status: 'error', message: 'Enter an invite link or token.' };
  }

  // Accept either a bare token or a full /invite/<token> URL pasted in.
  const trimmed = token.trim();
  const extracted = trimmed.includes('/') ? (trimmed.split('/').pop() ?? trimmed) : trimmed;

  try {
    const result = await joinViaInvite(extracted);
    return { status: 'idle', storyId: result.storyId };
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }
}

export async function transferOwnershipAction(storyId: string, newOwnerId: string): Promise<MemberActionState> {
  await requireUser();

  try {
    await transferStoryOwnership(storyId, newOwnerId);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/members`);
  return initialIdle;
}
