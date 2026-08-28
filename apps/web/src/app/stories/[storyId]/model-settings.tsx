'use client';

import { useActionState, useState } from 'react';

import {
  updateModelOverridesAction,
  type SettingsActionState,
} from '@/app/stories/[storyId]/settings-actions';
import { RoleModelPicker } from '@/app/stories/[storyId]/role-model-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FreeModel } from '@/lib/ai/openrouter-models';
import type { LocalModel } from '@/lib/ai/ollama-models';
import type { ModelConfig } from '@/lib/ai/roles';
import { CONFIGURABLE_TEXT_ROLES } from '@/lib/ai/roles';

const initialState: SettingsActionState = { status: 'idle' };

const ROLE_LABELS: Record<(typeof CONFIGURABLE_TEXT_ROLES)[number], string> = {
  researcher: 'Researcher',
  narrator: 'Narrator',
  validator: 'Validator',
  extractor: 'Extractor',
  summarizer: 'Summarizer',
  gatekeeper: 'Gatekeeper',
  moderator: 'Moderator',
};

/**
 * Lets the story owner or GM override which model runs each text role for this
 * story — e.g. to run the whole story on free OpenRouter models. Every field
 * is optional; "Project default" means the built-in default for that role.
 */
export function ModelSettings({
  storyId,
  modelConfig,
  freeModels,
  localModels,
}: {
  storyId: string;
  modelConfig: ModelConfig;
  freeModels: FreeModel[];
  /** Models installed on the local Ollama server; empty if it isn't running. */
  localModels: LocalModel[];
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
          <div className="grid gap-3 sm:grid-cols-2">
            {CONFIGURABLE_TEXT_ROLES.map((role) => (
              <RoleModelPicker
                key={role}
                role={role}
                label={ROLE_LABELS[role]}
                current={modelConfig[role]}
                freeModels={freeModels}
                localModels={localModels}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Pick a free OpenRouter model, a model running locally on your Ollama server, or choose{' '}
            <span className="font-medium">Custom…</span> to enter any model id (e.g.{' '}
            <code>anthropic/claude-sonnet-4.5</code>). When you are the GM, the story also uses your
            OpenRouter key from account settings — local models need no key. A local model only
            answers while your machine and Ollama are running.
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
