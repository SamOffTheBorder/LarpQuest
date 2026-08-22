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
  entityId = null,
  label,
  placeholder,
}: {
  storyId: string;
  turnId: string;
  existing: Submission | null;
  /** Fixed entity this form submits for; null submits with no entity attached. */
  entityId?: string | null;
  label?: string;
  placeholder?: string;
}) {
  const boundAction = submitAction.bind(null, storyId, turnId);
  const [state, action, pending] = useActionState(boundAction, initialState);

  const fieldId = `content-${entityId ?? 'none'}`;
  const resolvedLabel = label ?? 'What do you do?';

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="submissionId" value={existing?.id ?? ''} />
      <input type="hidden" name="entityId" value={entityId ?? ''} />
      <label htmlFor={fieldId} className="text-sm font-medium">
        {resolvedLabel}
        {existing !== null && ' (editing)'}
      </label>
      <Textarea
        id={fieldId}
        name="content"
        defaultValue={existing?.content ?? ''}
        placeholder={placeholder ?? "Describe your character's action this turn…"}
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
