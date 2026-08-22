'use client';

import { useState, useTransition } from 'react';

import { assignEntityAction, releaseEntityAction } from '@/app/stories/[storyId]/entities/claim-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface AssignableMember {
  userId: string;
  label: string;
}

/**
 * Who controls this character. A GM picks from the roster — including
 * themselves, which is an ordinary option rather than a separate control.
 * Everyone else sees the controller, and can put down a character they hold.
 */
export function AssignControl({
  storyId,
  entityId,
  controlledBy,
  currentUserId,
  members,
  canAssign,
}: {
  storyId: string;
  entityId: string;
  controlledBy: string | null;
  currentUserId: string;
  members: AssignableMember[];
  canAssign: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isMine = controlledBy === currentUserId;
  const controller = members.find((member) => member.userId === controlledBy) ?? null;

  function run(action: () => Promise<{ status: 'idle' | 'error'; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      setError(result.status === 'error' ? (result.message ?? 'Something went wrong.') : null);
    });
  }

  return (
    // The row sits inside a Link to the entity; without this the select would
    // navigate away instead of opening.
    <div
      className="flex flex-col items-end gap-1"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {canAssign ? (
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          value={controlledBy ?? ''}
          disabled={pending}
          onChange={(event) => {
            const value = event.target.value;
            run(() => assignEntityAction(storyId, entityId, value === '' ? null : value));
          }}
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.userId === currentUserId ? `${member.label} (you)` : member.label}
            </option>
          ))}
        </select>
      ) : isMine ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => releaseEntityAction(storyId, entityId))}
        >
          Release
        </Button>
      ) : controller !== null ? (
        <Badge variant="secondary">{controller.label}</Badge>
      ) : (
        <span className="text-xs text-muted-foreground">Unassigned</span>
      )}
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
