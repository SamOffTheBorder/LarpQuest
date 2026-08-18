'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { archiveStory, restoreStory } from '@/lib/engine/stories';

export type ArchiveActionState = {
  status: 'idle' | 'error';
  message?: string;
};

const initialIdle: ArchiveActionState = { status: 'idle' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export async function archiveStoryAction(storyId: string): Promise<ArchiveActionState> {
  const user = await requireUser();

  try {
    await archiveStory(storyId, user.id);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}`);
  revalidatePath('/stories');
  return initialIdle;
}

export async function restoreStoryAction(storyId: string): Promise<ArchiveActionState> {
  const user = await requireUser();

  try {
    await restoreStory(storyId, user.id);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}`);
  revalidatePath('/stories');
  return initialIdle;
}
