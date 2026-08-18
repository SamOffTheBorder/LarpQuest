'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { publishDraftAction, type ReviewActionState } from '@/app/universes/[draftId]/review/actions';
import { Button, buttonVariants } from '@/components/ui/button';

const initialState: ReviewActionState = { status: 'idle' };

/**
 * Publishing surfaces `DraftIncompleteError`'s named section inline (spec
 * "Publish is blocked on required sections") rather than a generic failure
 * message — the action already formats that error's message with the
 * section name, this component just displays it as-is. On success, links
 * into the story-creation flow with the new universe's id so starting a
 * story is one click away.
 */
export function PublishButton({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState(publishDraftAction.bind(null, draftId), initialState);

  if (state.publishedUniverseId !== undefined) {
    return (
      <div className="flex flex-col items-end gap-1">
        <p className="text-sm text-muted-foreground">Universe published.</p>
        <Link href="/stories/new" className={buttonVariants({ variant: 'default' })}>
          Start a story
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" disabled={pending}>
        {pending ? 'Publishing…' : 'Publish universe'}
      </Button>
      {state.status === 'error' && <p className="text-xs text-destructive">{state.message}</p>}
    </form>
  );
}
