'use client';

import { useActionState } from 'react';

import type { EntitySchema } from '@/lib/engine/schema';
import { createSchemaEntityAction, type EntityActionState } from '@/app/stories/[storyId]/entities/actions';
import { EntityFieldRenderer } from '@/app/stories/[storyId]/entities/entity-fields/field-renderer';
import { fieldFormName } from '@/app/stories/[storyId]/entities/entity-fields/entity-schema-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const initialState: EntityActionState = { status: 'idle' };

/**
 * Entity creation for a story with a pinned universe. One form per entity
 * type — matching how `entityType` is already selected before the action is
 * bound, since the create RPC takes a single type per call. Fields render
 * through the same `EntityFieldRenderer` the edit form uses, from the same
 * schema.
 */
export function NewSchemaEntityForm({
  storyId,
  entitySchema,
  entityType,
}: {
  storyId: string;
  entitySchema: EntitySchema;
  entityType: string;
}) {
  const definition = entitySchema.entity_types[entityType];
  const boundAction = createSchemaEntityAction.bind(null, storyId, entityType);
  const [state, action, pending] = useActionState(boundAction, initialState);

  if (definition === undefined) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New {definition.label.toLowerCase()}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <Input id="name" name="name" required />
          </div>

          {definition.fields.map((field) => (
            <EntityFieldRenderer
              key={field.key}
              field={field}
              name={fieldFormName(field.key)}
              defaultValue={undefined}
            />
          ))}

          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Add'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
