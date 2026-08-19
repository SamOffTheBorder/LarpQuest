'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { cloneUniverse } from '@/lib/engine/marketplace';

export type CloneActionState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export async function cloneUniverseAction(
  universeId: string,
  _prevState: CloneActionState,
): Promise<CloneActionState> {
  const user = await requireUser();

  try {
    await cloneUniverse(universeId, user.id);
    revalidatePath('/universes/marketplace');
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  return { status: 'success' };
}
