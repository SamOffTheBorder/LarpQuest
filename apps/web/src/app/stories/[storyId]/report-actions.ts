'use server';

import { requireUser } from '@/lib/auth';
import { reportChapter } from '@/lib/engine/reports';

export type ReportActionState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export async function reportChapterAction(
  chapterId: string,
  _prevState: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const user = await requireUser();

  const reason = formData.get('reason');
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return { status: 'error', message: 'A reason is required.' };
  }

  try {
    await reportChapter(chapterId, user.id, reason);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  return { status: 'success' };
}
