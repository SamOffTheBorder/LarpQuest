'use client';

import { useActionState } from 'react';

import {
  updateEntityFieldAction,
  type EntityActionState,
} from '@/app/stories/[storyId]/entities/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const initialState: EntityActionState = { status: 'idle' };

export function EditFieldForm({ storyId, entityId }: { storyId: string; entityId: string }) {
  const boundAction = updateEntityFieldAction.bind(null, storyId, entityId);
  const [state, action, pending] = useActionState(boundAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Edit a field</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="field" className="text-sm font-medium">
              Field
            </label>
            <Input id="field" name="field" placeholder="location" required />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="value" className="text-sm font-medium">
              Value
            </label>
            <Input id="value" name="value" placeholder={'"harbor" or 3 or {"a":1}'} required />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </form>
        {state.status === 'error' && (
          <p className="mt-2 text-sm text-destructive">{state.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
