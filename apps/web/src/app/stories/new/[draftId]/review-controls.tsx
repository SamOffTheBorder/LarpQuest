'use client';

import { useActionState } from 'react';

import {
  approveAction,
  regenerateAction,
  retryGenerateAction,
  saveNotesAction,
  type PremiseActionState,
} from '@/app/stories/new/[draftId]/actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * The controls that act on the premise as a whole: notes, regenerate, approve.
 *
 * Notes are one box for the whole premise rather than one per section. The
 * per-section cut already carries the "not this" signal; the notes carry the
 * cross-cutting steer ("less chosen-one, more ensemble") that belongs to no
 * single section (design.md decision 4).
 */

const initialState: PremiseActionState = { status: 'idle' };

export function NotesForm({ draftId, notes }: { draftId: string; notes: string }) {
  const [state, action, pending] = useActionState(saveNotesAction.bind(null, draftId), initialState);

  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="notes" className="text-sm font-medium">
        Anything else to steer the re-roll?
      </label>
      <Textarea
        id="notes"
        name="notes"
        rows={3}
        defaultValue={notes}
        placeholder="Less chosen-one energy, more ensemble. Keep the rain."
      />
      <p className="text-xs text-muted-foreground">
        Applied to the sections you cut. Kept sections are never rewritten.
      </p>
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? 'Saving…' : 'Save notes'}
        </Button>
      </div>
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
    </form>
  );
}

export function RegenerateButton({
  draftId,
  everythingKept,
}: {
  draftId: string;
  everythingKept: boolean;
}) {
  const [state, action, pending] = useActionState(
    regenerateAction.bind(null, draftId),
    initialState,
  );

  return (
    <form action={action} className="flex flex-col gap-1">
      <Button type="submit" variant="outline" disabled={pending || everythingKept}>
        {pending ? 'Re-rolling…' : 'Re-roll what I cut'}
      </Button>
      {everythingKept && (
        <p className="text-xs text-muted-foreground">Cut something first.</p>
      )}
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
    </form>
  );
}

export function ApproveButton({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState(approveAction.bind(null, draftId), initialState);

  return (
    <form action={action} className="flex flex-col gap-1">
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating story…' : 'Start this story'}
      </Button>
      {state.status === 'error' && (
        <div className="text-sm text-destructive">
          <p>{state.message}</p>
          {state.failedCast !== undefined && state.failedCast.length > 0 && (
            <ul className="list-disc pl-5 text-xs">
              {state.failedCast.map((failure) => (
                <li key={failure.name}>
                  {failure.name}: {failure.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

/** Shown when the first generation failed and left the draft with no premise. */
export function RetryGenerateButton({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState(
    retryGenerateAction.bind(null, draftId),
    initialState,
  );

  return (
    <form action={action} className="flex flex-col gap-2">
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Writing a premise…' : 'Try again'}
        </Button>
      </div>
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
    </form>
  );
}
