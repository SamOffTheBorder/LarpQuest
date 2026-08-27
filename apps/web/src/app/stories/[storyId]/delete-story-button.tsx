'use client';

import { useState, useTransition } from 'react';

import { deleteStoryAction } from '@/app/stories/[storyId]/archive-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** Owner-only, irreversible. Requires typing the story's title to confirm. */
export function DeleteStoryButton({ storyId, title }: { storyId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmText === title;

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await deleteStoryAction(storyId);
      // A successful delete redirects server-side and never returns here.
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setConfirmText('');
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="destructive" />}>Delete</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{title}&rdquo;?</DialogTitle>
          <DialogDescription>
            This permanently deletes the story and everything in it — chapters, entities,
            history, members, and invites. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label htmlFor="confirm-title" className="text-sm text-muted-foreground">
            Type <span className="font-medium text-foreground">{title}</span> to confirm.
          </label>
          <Input
            id="confirm-title"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            autoComplete="off"
          />
          {error !== null && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={run} disabled={!canDelete || pending}>
            {pending ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
