'use client';

import { useState, useTransition } from 'react';

import { revokeInviteAction } from '@/app/stories/[storyId]/members/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Invite } from '@/lib/engine/invites';

export function InviteList({ storyId, invites }: { storyId: string; invites: Invite[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function revoke(inviteId: string) {
    setError(null);
    setPendingId(inviteId);
    startTransition(async () => {
      const result = await revokeInviteAction(storyId, inviteId);
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      }
      setPendingId(null);
    });
  }

  async function copyLink(invite: Invite) {
    const url = `${window.location.origin}/invite/${invite.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId((current) => (current === invite.id ? null : current)), 2000);
    } catch {
      // Clipboard access can be denied; the link is still visible in the row.
    }
  }

  if (invites.length === 0) {
    return <p className="text-sm text-muted-foreground">No invites yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Revoked invites are filtered out server-side, so every row here is live or expired. */}
      {invites.map((invite) => {
        const expired = new Date(invite.expiresAt).getTime() < Date.now();

        return (
          <div key={invite.id} className="flex flex-col gap-2 rounded-md border p-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{invite.role}</Badge>
                {expired && <Badge variant="secondary">Expired</Badge>}
                <span className="text-muted-foreground">{invite.useCount} joined</span>
              </div>
              <div className="flex items-center gap-2">
                {!expired && (
                  <Button variant="ghost" size="sm" onClick={() => copyLink(invite)}>
                    {copiedId === invite.id ? 'Copied' : 'Copy link'}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingId === invite.id}
                  onClick={() => revoke(invite.id)}
                >
                  Revoke
                </Button>
              </div>
            </div>

            {invite.joiners.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Joined:{' '}
                {invite.joiners
                  .map((joiner) => joiner.username ?? `Player ${joiner.userId.slice(0, 8)}`)
                  .join(', ')}
              </p>
            )}
          </div>
        );
      })}
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
