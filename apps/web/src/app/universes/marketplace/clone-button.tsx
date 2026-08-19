'use client';

import { useActionState } from 'react';

import { cloneUniverseAction, type CloneActionState } from '@/app/universes/marketplace/actions';
import { Button } from '@/components/ui/button';

const initialState: CloneActionState = { status: 'idle' };

export function CloneButton({ universeId }: { universeId: string }) {
  const boundAction = cloneUniverseAction.bind(null, universeId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  if (state.status === 'success') {
    return <p className="text-xs text-muted-foreground">Cloned to your universes.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? 'Cloning…' : 'Clone'}
      </Button>
      {state.status === 'error' && <p className="text-xs text-destructive">{state.message}</p>}
    </form>
  );
}
