'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { deleteAccountAction, type DeleteAccountState } from '@/lib/engine/account-deletion-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const INITIAL: DeleteAccountState = { status: 'idle' };
const CONFIRM_PHRASE = 'delete my account';

export function DeleteAccountForm() {
  const [state, formAction, pending] = useActionState(deleteAccountAction, INITIAL);
  const [confirmText, setConfirmText] = useState('');

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <label htmlFor="confirm" className="text-sm font-medium">
        Type <span className="font-mono">{CONFIRM_PHRASE}</span> to confirm
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="confirm"
          name="confirm"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          autoComplete="off"
          className="max-w-64"
        />
        <Button type="submit" variant="destructive" disabled={pending || confirmText !== CONFIRM_PHRASE}>
          {pending ? 'Deleting…' : 'Delete my account'}
        </Button>
      </div>

      {state.status === 'error' && (
        <div role="alert" className="mt-1 text-sm text-destructive">
          <p>{state.message}</p>
          {state.blockedStories !== undefined && state.blockedStories.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {state.blockedStories.map((story) => (
                <li key={story.storyId}>
                  <Link href={`/stories/${story.storyId}/members`} className="underline">
                    {story.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
