'use client';

import { useActionState } from 'react';

import {
  removeOpenRouterKeyAction,
  saveOpenRouterKeyAction,
  type OpenRouterKeyActionState,
} from '@/app/settings/openrouter/openrouter-key-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const openRouterKeyIdleState: OpenRouterKeyActionState = { status: 'idle' };

/**
 * Save / replace / remove the signed-in user's OpenRouter key. The plaintext
 * key is never sent back from the server — the saved state shows only the
 * `••••••••1234` fingerprint the page computed server-side.
 */
export function OpenRouterKeyForm({
  fingerprint,
  savedAt,
}: {
  fingerprint: string | null;
  savedAt: string | null;
}) {
  const [saveState, save, saving] = useActionState<OpenRouterKeyActionState, FormData>(
    saveOpenRouterKeyAction,
    openRouterKeyIdleState,
  );
  const [removeState, remove, removing] = useActionState<OpenRouterKeyActionState, FormData>(
    removeOpenRouterKeyAction,
    openRouterKeyIdleState,
  );

  const errorMessage =
    saveState.status === 'error'
      ? saveState.message
      : removeState.status === 'error'
        ? removeState.message
        : null;

  if (fingerprint !== null) {
    return (
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm">
          Saved key <code className="rounded bg-muted px-1.5 py-0.5">••••••••{fingerprint}</code>
          {savedAt !== null && (
            <span className="text-muted-foreground"> · added {new Date(savedAt).toLocaleDateString()}</span>
          )}
        </p>
        <form action={save} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="key" className="text-sm font-medium">
              Replace key
            </label>
            <Input id="key" name="key" type="password" placeholder="sk-or-v1-…" autoComplete="off" />
          </div>
          <Button type="submit" variant="secondary" disabled={saving}>
            {saving ? 'Saving…' : 'Replace'}
          </Button>
        </form>
        <form action={remove}>
          <Button type="submit" variant="ghost" disabled={removing} className="text-destructive">
            {removing ? 'Removing…' : 'Remove key'}
          </Button>
        </form>
        {errorMessage !== null && <p className="text-sm text-destructive">{errorMessage}</p>}
        {saveState.status === 'saved' && (
          <p className="text-sm text-muted-foreground">{saveState.message}</p>
        )}
      </div>
    );
  }

  return (
    <form action={save} className="mt-3 flex flex-col gap-2">
      <label htmlFor="key" className="text-sm font-medium">
        OpenRouter API key
      </label>
      <Input id="key" name="key" type="password" placeholder="sk-or-v1-…" autoComplete="off" required />
      <p className="text-xs text-muted-foreground">
        Stored encrypted. Get one at{' '}
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          openrouter.ai/keys
        </a>
        .
      </p>
      {errorMessage !== null && <p className="text-sm text-destructive">{errorMessage}</p>}
      <Button type="submit" variant="secondary" disabled={saving} className="self-start">
        {saving ? 'Saving…' : 'Save key'}
      </Button>
    </form>
  );
}
