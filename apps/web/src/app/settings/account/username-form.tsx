'use client';

import { useActionState } from 'react';

import {
  setUsernameAction,
  type UsernameActionState,
} from '@/app/settings/account/username-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const initialState: UsernameActionState = { status: 'idle' };

export function UsernameForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState(setUsernameAction, initialState);

  return (
    <form action={action} className="mt-3 flex flex-col gap-2">
      <label htmlFor="username" className="text-sm font-medium">
        Username
      </label>
      <Input
        id="username"
        name="username"
        defaultValue={current ?? ''}
        placeholder="storyweaver"
        minLength={3}
        maxLength={32}
        pattern="[A-Za-z0-9_\-]+"
        required
      />
      <p className="text-xs text-muted-foreground">
        3–32 characters: letters, numbers, underscores, and hyphens.
      </p>
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
      {state.status === 'saved' && <p className="text-sm text-muted-foreground">{state.message}</p>}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {pending ? 'Saving…' : current === null ? 'Set username' : 'Update username'}
      </Button>
    </form>
  );
}
