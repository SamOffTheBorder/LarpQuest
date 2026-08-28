'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';
import type { FreeModel } from '@/lib/ai/openrouter-models';
import type { LocalModel } from '@/lib/ai/ollama-models';

const CUSTOM = '__custom__';
const DEFAULT = '';

/**
 * One role's model selection: pick a project default (blank), a free
 * OpenRouter model, a model installed on the local Ollama server, or
 * "Custom…" to type any model id. Submits the chosen id (or empty for
 * default) under `name={role}`.
 */
export function RoleModelPicker({
  role,
  label,
  current,
  freeModels,
  localModels,
}: {
  role: string;
  label: string;
  current: string | undefined;
  freeModels: FreeModel[];
  localModels: LocalModel[];
}) {
  const presetModels = [...freeModels, ...localModels];
  const currentIsPreset = current !== undefined && presetModels.some((m) => m.id === current);
  const startMode =
    current === undefined || current === '' ? DEFAULT : currentIsPreset ? current : CUSTOM;

  const [mode, setMode] = useState<string>(startMode);
  const [customValue, setCustomValue] = useState(currentIsPreset || !current ? '' : current);

  // The value actually submitted for this role.
  const submitted = mode === DEFAULT ? '' : mode === CUSTOM ? customValue : mode;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${role}-select`} className="text-sm font-medium capitalize">
        {label}
      </label>
      <input type="hidden" name={role} value={submitted} />
      <select
        id={`${role}-select`}
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
      >
        <option value={DEFAULT}>Project default</option>
        {localModels.length > 0 && (
          <optgroup label="Local (Ollama)">
            {localModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Free OpenRouter models">
          {freeModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
        <option value={CUSTOM}>Custom…</option>
      </select>
      {mode === CUSTOM && (
        <Input
          aria-label={`${label} custom model id`}
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          placeholder="e.g. anthropic/claude-sonnet-4.5"
        />
      )}
    </div>
  );
}
