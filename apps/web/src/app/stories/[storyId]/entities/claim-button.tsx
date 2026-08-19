'use client';

import { useState, useTransition } from 'react';

import { claimEntityAction, releaseEntityAction } from '@/app/stories/[storyId]/entities/claim-actions';
import { Button } from '@/components/ui/button';

export function ClaimButton({
  storyId,
  entityId,
  controlledBy,
  currentUserId,
}: {
  storyId: string;
  entityId: string;
  controlledBy: string | null;
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isMine = controlledBy === currentUserId;
  const isClaimed = controlledBy !== null;

  function run(action: () => Promise<{ status: 'idle' | 'error'; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1" onClick={(event) => event.preventDefault()}>
      {isMine ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => releaseEntityAction(storyId, entityId))}
        >
          Release
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={pending || isClaimed}
          onClick={() => run(() => claimEntityAction(storyId, entityId))}
        >
          {isClaimed ? 'Claimed' : 'Claim'}
        </Button>
      )}
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
