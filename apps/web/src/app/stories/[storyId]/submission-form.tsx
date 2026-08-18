'use client';

import { useActionState } from 'react';

import { submitAction, type TurnActionState } from '@/app/stories/[storyId]/actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Submission } from '@/lib/engine/turns';

const initialState: TurnActionState = { status: 'idle' };

export function SubmissionForm({
  storyId,
  turnId,
  existing,
}: {
  storyId: string;
  turnId: string;
  existing: Submission | null;
}) {
  const boundAction = submitAction.bind(null, storyId, turnId);
  const [state, action, pending] = useActionState(boundAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="submissionId" value={existing?.id ?? ''} />
      <label htmlFor="content" className="text-sm font-medium">
        {existing !== null ? 'Your action (editing)' : 'What do you do?'}
      </label>
      <Textarea
        id="content"
        name="content"
        defaultValue={existing?.content ?? ''}
        placeholder="Describe your character's action this turn…"
        required
        rows={3}
      />
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {pending ? 'Saving…' : existing !== null ? 'Update submission' : 'Submit'}
      </Button>
    </form>
  );
}
