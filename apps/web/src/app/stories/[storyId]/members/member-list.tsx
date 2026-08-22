'use client';

import { useState, useTransition } from 'react';

import { removeMemberAction, transferOwnershipAction } from '@/app/stories/[storyId]/members/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { StoryMember } from '@/lib/engine/membership';

export function MemberList({
  storyId,
  members,
  currentUserId,
  canManage,
}: {
  storyId: string;
  members: StoryMember[];
  currentUserId: string;
  canManage: boolean;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const isOwner = members.some((member) => member.userId === currentUserId && member.role === 'owner');
  const transferCandidates = members.filter((member) => member.userId !== currentUserId);

  function remove(userId: string) {
    setError(null);
    setPendingId(userId);
    startTransition(async () => {
      const result = await removeMemberAction(storyId, userId);
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      }
      setPendingId(null);
    });
  }

  function transfer() {
    if (transferTargetId === null) {
      return;
    }
    setError(null);
    setPendingId(transferTargetId);
    startTransition(async () => {
      const result = await transferOwnershipAction(storyId, transferTargetId);
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      } else {
        setTransferTargetId(null);
      }
      setPendingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {members.map((member) => (
        <div key={member.userId} className="flex items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <span>{member.userId === currentUserId ? 'You' : member.userId}</span>
            <Badge variant="outline">{member.role}</Badge>
          </div>
          {canManage && member.role !== 'owner' && member.userId !== currentUserId && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pendingId === member.userId}
              onClick={() => remove(member.userId)}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      {isOwner && transferCandidates.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Transfer ownership to</span>
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={transferTargetId ?? ''}
            onChange={(event) => setTransferTargetId(event.target.value || null)}
          >
            <option value="">Choose a member…</option>
            {transferCandidates.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.userId} ({member.role})
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            disabled={transferTargetId === null || pendingId !== null}
            onClick={transfer}
          >
            Transfer
          </Button>
          <span className="w-full text-xs text-muted-foreground">
            You will become GM. This cannot be undone from here — the new owner can transfer it back.
          </span>
        </div>
      )}
    </div>
  );
}
