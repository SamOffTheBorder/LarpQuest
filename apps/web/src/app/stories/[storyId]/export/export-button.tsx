'use client';

import { useActionState } from 'react';

import { requestExportAction, type ExportActionState } from '@/app/stories/[storyId]/export/actions';
import type { ExportFormat } from '@/lib/engine/export';
import { Button } from '@/components/ui/button';

const initialState: ExportActionState = { status: 'idle' };

const FORMAT_LABELS: Record<ExportFormat, string> = {
  markdown: 'Markdown',
  pdf: 'PDF',
  epub: 'EPUB',
};

export function ExportButton({ storyId, format }: { storyId: string; format: ExportFormat }) {
  const boundAction = requestExportAction.bind(null, storyId, format);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Generating…' : `Export as ${FORMAT_LABELS[format]}`}
      </Button>
      {state.status === 'success' && state.downloadUrl !== undefined && (
        <a href={state.downloadUrl} className="text-sm text-primary underline" download>
          Download {FORMAT_LABELS[format]}
        </a>
      )}
      {state.status === 'error' && <p className="text-xs text-destructive">{state.message}</p>}
    </form>
  );
}
