'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { assignEntity, releaseEntity } from '@/lib/engine/entity-claims';

export type ClaimActionState = {
  status: 'idle' | 'error';
  message?: string;
};

const initialIdle: ClaimActionState = { status: 'idle' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** GM/owner only. `controllerId` of null unassigns the character. */
export async function assignEntityAction(
  storyId: string,
  entityId: string,
  controllerId: string | null,
): Promise<ClaimActionState> {
  const user = await requireUser();

  try {
    await assignEntity(entityId, user.id, controllerId);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/entities`);
  revalidatePath(`/stories/${storyId}`);
  return initialIdle;
}

export async function releaseEntityAction(storyId: string, entityId: string): Promise<ClaimActionState> {
  const user = await requireUser();

  try {
    await releaseEntity(entityId, user.id);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/entities`);
  revalidatePath(`/stories/${storyId}`);
  return initialIdle;
}
