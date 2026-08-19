'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { getExportDownloadUrl, requestExport, type ExportFormat } from '@/lib/engine/export';

export type ExportActionState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
  downloadUrl?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export async function requestExportAction(
  storyId: string,
  format: ExportFormat,
  _prevState: ExportActionState,
  _formData: FormData,
): Promise<ExportActionState> {
  const user = await requireUser();

  try {
    const job = await requestExport(storyId, user.id, format);
    revalidatePath(`/stories/${storyId}/export`);

    if (job.status === 'failed') {
      return { status: 'error', message: job.error ?? 'Export failed.' };
    }

    const downloadUrl = await getExportDownloadUrl(job.id, user.id);
    return { status: 'success', downloadUrl };
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }
}
