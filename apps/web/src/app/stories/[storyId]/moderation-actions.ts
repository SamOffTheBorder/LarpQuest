'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { hideChapter, unhideChapter } from '@/lib/engine/chapters';
import { resolveReport } from '@/lib/engine/reports';

export type ModerationActionState = {
  status: 'idle' | 'error';
  message?: string;
};

const initialIdle: ModerationActionState = { status: 'idle' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export async function hideChapterAction(storyId: string, chapterId: string): Promise<ModerationActionState> {
  const user = await requireUser();

  try {
    await hideChapter(chapterId, user.id);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}`);
  revalidatePath(`/stories/${storyId}/members`);
  return initialIdle;
}

export async function unhideChapterAction(storyId: string, chapterId: string): Promise<ModerationActionState> {
  const user = await requireUser();

  try {
    await unhideChapter(chapterId, user.id);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}`);
  revalidatePath(`/stories/${storyId}/members`);
  return initialIdle;
}

export async function resolveReportAction(storyId: string, reportId: string): Promise<ModerationActionState> {
  const user = await requireUser();

  try {
    await resolveReport(reportId, user.id);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/members`);
  return initialIdle;
}
