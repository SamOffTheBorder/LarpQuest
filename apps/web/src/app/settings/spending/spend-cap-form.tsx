'use client';

import { useActionState } from 'react';

import { saveUserSpendCapAction, type SpendCapFormState } from '@/lib/ai/spend-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const INITIAL: SpendCapFormState = { status: 'idle' };

export function SpendCapForm({
  initialCapUsd,
  defaultCapUsd,
}: {
  initialCapUsd: number | null;
  defaultCapUsd: number;
}) {
  const [state, formAction, pending] = useActionState(saveUserSpendCapAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="cap" className="text-sm font-medium">
        Your account cap (USD)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="cap"
          name="cap"
          inputMode="decimal"
          defaultValue={initialCapUsd === null ? '' : String(initialCapUsd)}
          placeholder={`${defaultCapUsd} (default)`}
          className="max-w-40"
          aria-describedby="cap-help"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p id="cap-help" className="text-sm text-muted-foreground">
        Leave blank to use the default of ${defaultCapUsd.toFixed(2)}. Zero stops all generation.
      </p>
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      {state.status === 'saved' && (
        <p role="status" className="text-sm text-success">
          Saved.
        </p>
      )}
    </form>
  );
}
