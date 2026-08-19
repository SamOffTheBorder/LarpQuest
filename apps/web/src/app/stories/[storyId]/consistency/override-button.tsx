'use client';

import { useActionState, useState } from 'react';

import type { OverrideActionState } from '@/app/stories/[storyId]/consistency/override-actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const initialState: OverrideActionState = { status: 'idle' };

/** Generic override trigger — bound to either overrideValidationFlagAction or
 * overrideProposalAction by the caller, so this component knows nothing about
 * which kind of flag it's overriding. */
export function OverrideButton({
  action,
}: {
  action: (prevState: OverrideActionState, formData: FormData) => Promise<OverrideActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, initialState);

  if (state.status === 'success') {
    return <p className="text-xs text-muted-foreground">Overridden — this will not be flagged again.</p>;
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Override
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Textarea name="exceptionNote" placeholder="Why should this be allowed going forward?" required rows={2} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Confirm override'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {state.status === 'error' && <p className="text-xs text-destructive">{state.message}</p>}
    </form>
  );
}
