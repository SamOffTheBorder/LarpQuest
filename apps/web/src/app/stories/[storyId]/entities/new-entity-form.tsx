'use client';

import { useActionState } from 'react';

import { createEntityAction, type EntityActionState } from '@/app/stories/[storyId]/entities/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const initialState: EntityActionState = { status: 'idle' };

export function NewEntityForm({ storyId }: { storyId: string }) {
  const boundAction = createEntityAction.bind(null, storyId);
  const [state, action, pending] = useActionState(boundAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New entity</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <Input id="name" name="name" placeholder="Kestrel Vane" required />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="type" className="text-sm font-medium">
              Type
            </label>
            <Input id="type" name="type" placeholder="character" required />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Add'}
          </Button>
        </form>
        {state.status === 'error' && (
          <p className="mt-2 text-sm text-destructive">{state.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
