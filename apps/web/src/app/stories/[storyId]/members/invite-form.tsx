'use client';

import { useActionState } from 'react';

import { createInviteAction, type MemberActionState } from '@/app/stories/[storyId]/members/actions';
import { Button } from '@/components/ui/button';

const initialState: MemberActionState = { status: 'idle' };

export function InviteForm({ storyId }: { storyId: string }) {
  const boundAction = createInviteAction.bind(null, storyId);
  const [state, action, pending] = useActionState(boundAction, initialState);

  return (
    <form action={action} className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="role" className="text-sm font-medium">
          Role for the invite
        </label>
        <select
          id="role"
          name="role"
          defaultValue="player"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="player">Player</option>
          <option value="gm">GM</option>
          <option value="spectator">Spectator</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create invite'}
      </Button>
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
    </form>
  );
}
