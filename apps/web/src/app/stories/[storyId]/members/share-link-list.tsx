'use client';

import { useState, useTransition } from 'react';

import { createShareLinkAction, revokeShareLinkAction } from '@/app/stories/[storyId]/members/actions';
import { Button } from '@/components/ui/button';
import type { ShareLinkRecord } from '@/lib/engine/share-links';

export function ShareLinkList({ storyId, shareLinks }: { storyId: string; shareLinks: ShareLinkRecord[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function create() {
    setError(null);
    setCreating(true);
    startTransition(async () => {
      const result = await createShareLinkAction(storyId);
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      }
      setCreating(false);
    });
  }

  function revoke(shareLinkId: string) {
    setError(null);
    setPendingId(shareLinkId);
    startTransition(async () => {
      const result = await revokeShareLinkAction(storyId, shareLinkId);
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      }
      setPendingId(null);
    });
  }

  async function copyLink(link: ShareLinkRecord) {
    const url = `${window.location.origin}/share/${link.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((current) => (current === link.id ? null : current)), 2000);
    } catch {
      // Clipboard access can be denied; the link is still visible in the row.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        A share link is public and unauthenticated — anyone with it can read this story&apos;s
        published chapters.
      </p>
      {shareLinks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active share links.</p>
      ) : (
        shareLinks.map((link) => (
          <div key={link.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
            <span className="truncate text-muted-foreground">/share/{link.token}</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => copyLink(link)}>
                {copiedId === link.id ? 'Copied' : 'Copy link'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pendingId === link.id}
                onClick={() => revoke(link.id)}
              >
                Revoke
              </Button>
            </div>
          </div>
        ))
      )}
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button variant="outline" size="sm" disabled={creating} onClick={create}>
          {creating ? 'Creating…' : 'Create share link'}
        </Button>
      </div>
    </div>
  );
}
