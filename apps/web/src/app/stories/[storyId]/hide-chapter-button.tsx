'use client';

import { useState, useTransition } from 'react';

import { hideChapterAction, unhideChapterAction } from '@/app/stories/[storyId]/moderation-actions';
import { Button } from '@/components/ui/button';

export function HideChapterButton({
  storyId,
  chapterId,
  hidden,
}: {
  storyId: string;
  chapterId: string;
  hidden: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const action = hidden ? unhideChapterAction : hideChapterAction;
      const result = await action(storyId, chapterId);
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={run}>
        {pending ? 'Working…' : hidden ? 'Unhide chapter' : 'Hide chapter'}
      </Button>
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
