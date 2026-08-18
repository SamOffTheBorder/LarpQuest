'use client';

import { useActionState } from 'react';

import type { EntitySchema } from '@/lib/engine/schema';
import type { EntityActionState } from '@/app/stories/[storyId]/entities/actions';
import { EntityFieldRenderer } from '@/app/stories/[storyId]/entities/entity-fields/field-renderer';
import { Button } from '@/components/ui/button';

/**
 * Renders every field of one entity type from its schema — the container
 * `entity-schema` spec calls for ("Form renders from schema alone"). Walks
 * `entitySchema.entity_types[entityType].fields` and delegates each to
 * `EntityFieldRenderer`; assembly of the submitted values back into `data`
 * happens server-side via `parseEntityFormData`, using the same field list.
 */

export function fieldFormName(key: string): string {
  return `field:${key}`;
}

export interface EntitySchemaFormProps {
  entitySchema: EntitySchema;
  entityType: string;
  data?: Record<string, unknown>;
  action: (prevState: EntityActionState, formData: FormData) => Promise<EntityActionState>;
  initialState: EntityActionState;
  submitLabel: string;
  pendingLabel: string;
  errorMessage: (state: EntityActionState) => string | undefined;
}

export function EntitySchemaForm({
  entitySchema,
  entityType,
  data = {},
  action,
  initialState,
  submitLabel,
  pendingLabel,
  errorMessage,
}: EntitySchemaFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const definition = entitySchema.entity_types[entityType];

  if (definition === undefined) {
    return <p className="text-sm text-destructive">Unknown entity type &quot;{entityType}&quot;.</p>;
  }

  const message = errorMessage(state);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {definition.fields.map((field) => (
        <EntityFieldRenderer
          key={field.key}
          field={field}
          name={fieldFormName(field.key)}
          defaultValue={data[field.key]}
        />
      ))}

      {message !== undefined && <p className="text-sm text-destructive">{message}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
