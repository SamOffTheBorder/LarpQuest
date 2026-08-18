'use client';

import { useState, useTransition } from 'react';

import { rerunStageAction } from '@/app/universes/[draftId]/review/actions';
import { Button } from '@/components/ui/button';
import type { ResearchStage } from '@/lib/research/schemas';

/**
 * Re-run a single stage and, once a prior generation exists, show a diff
 * against it (universe-review spec, "Diff is shown after re-run"). The diff
 * is computed here rather than stored — design.md decision 7 — from whatever
 * `previous_output`/`output` the server component currently has.
 */
export function RerunDiff({
  draftId,
  stage,
  currentOutput,
  previousOutput,
}: {
  draftId: string;
  stage: ResearchStage;
  currentOutput: unknown;
  previousOutput: unknown;
}) {
  const [isPending, startTransition] = useTransition();
  const [showDiff, setShowDiff] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={() => startTransition(() => rerunStageAction(draftId, stage))}
      >
        {isPending ? 'Re-running…' : 'Re-run'}
      </Button>

      {previousOutput !== null && previousOutput !== undefined && (
        <Button size="sm" variant="link" onClick={() => setShowDiff((v) => !v)}>
          {showDiff ? 'Hide diff' : 'Show diff vs. previous'}
        </Button>
      )}

      {showDiff && (
        <div className="grid w-full grid-cols-2 gap-2 text-xs">
          <div>
            <p className="font-medium text-muted-foreground">Previous</p>
            <pre className="max-h-64 overflow-auto rounded border bg-muted p-2">
              {JSON.stringify(previousOutput, null, 2)}
            </pre>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Current</p>
            <pre className="max-h-64 overflow-auto rounded border bg-muted p-2">
              {JSON.stringify(currentOutput, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
