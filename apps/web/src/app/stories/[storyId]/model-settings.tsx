'use client';

import { useActionState, useState } from 'react';

import {
  updateModelOverridesAction,
  type SettingsActionState,
} from '@/app/stories/[storyId]/settings-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const initialState: SettingsActionState = { status: 'idle' };

/**
 * Lets the story owner override which model runs the narrator/extractor
 * roles for this story — e.g. to switch to a free OpenRouter model when a
 * paid model's request exceeds the account's remaining credit. Both fields
 * are optional; blank means "use the project default."
 */
export function ModelSettings({
  storyId,
  narrator,
  extractor,
}: {
  storyId: string;
  narrator: string | undefined;
  extractor: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = updateModelOverridesAction.bind(null, storyId);
  const [state, action, pending] = useActionState(boundAction, initialState);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs text-muted-foreground underline"
      >
        Model settings
      </button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Model overrides</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="narrator" className="text-sm font-medium">
              Narrator model
            </label>
            <Input
              id="narrator"
              name="narrator"
              defaultValue={narrator ?? ''}
              placeholder="Leave blank for the project default"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="extractor" className="text-sm font-medium">
              Extractor model
            </label>
            <Input
              id="extractor"
              name="extractor"
              defaultValue={extractor ?? ''}
              placeholder="Leave blank for the project default"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Use an OpenRouter model id, e.g. <code>nvidia/nemotron-3-super-120b-a12b:free</code>.
          </p>
          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
