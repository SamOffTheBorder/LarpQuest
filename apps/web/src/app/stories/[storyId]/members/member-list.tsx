'use client';

import { useState, useTransition } from 'react';

import { removeMemberAction } from '@/app/stories/[storyId]/members/actions';
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
  const [, startTransition] = useTransition();

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
    </div>
  );
}
