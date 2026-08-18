'use client';

import { useState, useTransition } from 'react';

import { rollbackChapterAction } from '@/app/stories/[storyId]/rollback-actions';
import { Button } from '@/components/ui/button';

export function RollbackButton({ storyId, chapterId }: { storyId: string; chapterId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      const outcome = await rollbackChapterAction(storyId, chapterId);

      if (outcome.status === 'error') {
        setResult({ error: outcome.message ?? 'Something went wrong.' });
        return;
      }

      const conflictNote =
        outcome.conflictCount !== undefined && outcome.conflictCount > 0
          ? ` (${outcome.conflictCount} field${outcome.conflictCount === 1 ? '' : 's'} left unchanged — since edited elsewhere)`
          : '';

      setResult({ message: `Reversed ${outcome.reversedCount ?? 0} change(s).${conflictNote}` });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={run}>
        {pending ? 'Rolling back…' : 'Roll back'}
      </Button>
      {result?.error !== undefined && (
        <p className="text-xs text-destructive">{result.error}</p>
      )}
      {result?.message !== undefined && (
        <p className="text-xs text-muted-foreground">{result.message}</p>
      )}
    </div>
  );
}
