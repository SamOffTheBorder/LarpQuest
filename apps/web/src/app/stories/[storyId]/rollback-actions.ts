'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { rollbackChapter } from '@/lib/engine/chapters';

export type RollbackActionState = {
  status: 'idle' | 'error' | 'done';
  message?: string;
  reversedCount?: number;
  conflictCount?: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export async function rollbackChapterAction(
  storyId: string,
  chapterId: string,
): Promise<RollbackActionState> {
  const user = await requireUser();

  try {
    const result = await rollbackChapter(chapterId, user.id, storyId);
    revalidatePath(`/stories/${storyId}`);

    return {
      status: 'done',
      reversedCount: result.reversedCount,
      conflictCount: result.conflicts.length,
    };
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }
}
