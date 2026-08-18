'use client';

import { useState, useTransition } from 'react';

import { archiveStoryAction, restoreStoryAction } from '@/app/stories/[storyId]/archive-actions';
import { Button } from '@/components/ui/button';

export function ArchiveButton({ storyId, archived }: { storyId: string; archived: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const action = archived ? restoreStoryAction : archiveStoryAction;
      const result = await action(storyId);
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" disabled={pending} onClick={run}>
        {pending ? '…' : archived ? 'Restore' : 'Archive'}
      </Button>
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
