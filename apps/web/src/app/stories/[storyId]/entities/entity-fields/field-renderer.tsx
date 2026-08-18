'use client';

import type { Field } from '@/lib/engine/schema';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Dynamic entity field rendering (entity-schema spec, "Dynamic entity form
 * rendering").
 *
 * One component per primitive, selected by `field.type` — the same bounded
 * dispatch `buildEntityDataValidator` uses server-side. Nothing here
 * references a specific universe, genre, or media type; the two structurally
 * incompatible fixture universes (Ashfall Legion, Wovenmere) render through
 * this exact same switch.
 *
 * `string`/`text`/`enum`/`number`/`resource`/`reference` get a native control
 * matching their shape. The remaining primitives (`capability_list`,
 * `relationship_map`, `knowledge_set`, `standing_map`, `tag_list`) are
 * structured values without a natural single-line control, so they render as
 * a JSON textarea — still one component selected by type, not a rich
 * list/matrix editor, which the entity-schema spec does not require and
 * which is better scoped as its own follow-up once real usage shows what
 * editing affordance each actually needs.
 */

export interface EntityFieldProps {
  field: Field;
  name: string;
  defaultValue: unknown;
}

function jsonDefault(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback, null, 2);
}

export function EntityFieldRenderer({ field, name, defaultValue }: EntityFieldProps) {
  const label = field.label ?? field.key;

  switch (field.type) {
    case 'string':
      return (
        <FieldShell label={label}>
          <Input
            id={name}
            name={name}
            defaultValue={typeof defaultValue === 'string' ? defaultValue : ''}
            required={field.required}
          />
        </FieldShell>
      );

    case 'text':
      return (
        <FieldShell label={label}>
          <Textarea
            id={name}
            name={name}
            defaultValue={typeof defaultValue === 'string' ? defaultValue : ''}
            required={field.required}
          />
        </FieldShell>
      );

    case 'enum':
      return (
        <FieldShell label={label}>
          <Select
            name={name}
            defaultValue={typeof defaultValue === 'string' ? defaultValue : undefined}
          >
            <SelectTrigger id={name} className="w-full">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {field.values.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>
      );

    case 'number':
      return (
        <FieldShell label={label}>
          <Input
            id={name}
            name={name}
            type="number"
            min={field.min}
            max={field.max}
            defaultValue={typeof defaultValue === 'number' ? defaultValue : ''}
            required={field.required}
          />
        </FieldShell>
      );

    case 'resource': {
      const current =
        typeof defaultValue === 'object' && defaultValue !== null && 'current' in defaultValue
          ? (defaultValue as { current: unknown }).current
          : 0;

      return (
        <FieldShell label={`${label} (0–${field.max})`}>
          <Input
            id={name}
            name={name}
            type="number"
            min={0}
            max={field.max}
            defaultValue={typeof current === 'number' ? current : 0}
            required={field.required}
          />
        </FieldShell>
      );
    }

    case 'reference':
      return (
        <FieldShell label={label}>
          <Input
            id={name}
            name={name}
            placeholder="Entity id or name"
            defaultValue={typeof defaultValue === 'string' ? defaultValue : ''}
            required={field.required}
          />
        </FieldShell>
      );

    case 'capability_list':
    case 'relationship_map':
    case 'knowledge_set':
    case 'standing_map':
    case 'tag_list':
      return (
        <FieldShell label={label} hint="JSON">
          <Textarea
            id={name}
            name={name}
            className="font-mono text-xs"
            rows={4}
            defaultValue={jsonDefault(defaultValue, compositeDefault(field.type))}
            required={field.required}
          />
        </FieldShell>
      );

    default: {
      const exhaustive: never = field;
      throw new Error(`Unhandled field type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function compositeDefault(type: Field['type']): unknown {
  switch (type) {
    case 'capability_list':
    case 'knowledge_set':
    case 'tag_list':
      return [];
    case 'relationship_map':
    case 'standing_map':
      return {};
    default:
      return null;
  }
}

function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={label} className="flex items-baseline justify-between text-sm font-medium">
        <span>{label}</span>
        {hint !== undefined && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
