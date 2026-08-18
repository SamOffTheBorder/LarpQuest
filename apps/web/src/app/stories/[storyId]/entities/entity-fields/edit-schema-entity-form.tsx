'use client';

import type { EntitySchema } from '@/lib/engine/schema';
import { updateSchemaEntityAction, type EntityActionState } from '@/app/stories/[storyId]/entities/actions';
import { EntitySchemaForm } from '@/app/stories/[storyId]/entities/entity-fields/entity-schema-form';

const initialState: EntityActionState = { status: 'idle' };

/** Edit form for an entity of a schema-defined type, prefilled from its current data. */
export function EditSchemaEntityForm({
  storyId,
  entityId,
  entitySchema,
  entityType,
  data,
}: {
  storyId: string;
  entityId: string;
  entitySchema: EntitySchema;
  entityType: string;
  data: Record<string, unknown>;
}) {
  const boundAction = updateSchemaEntityAction.bind(null, storyId, entityId);

  return (
    <EntitySchemaForm
      entitySchema={entitySchema}
      entityType={entityType}
      data={data}
      action={boundAction}
      initialState={initialState}
      submitLabel="Save"
      pendingLabel="Saving…"
      errorMessage={(state) => (state.status === 'error' ? state.message : undefined)}
    />
  );
}
