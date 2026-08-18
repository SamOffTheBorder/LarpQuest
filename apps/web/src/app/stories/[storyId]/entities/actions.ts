'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { createEntity, entityInputSchema, getEntity, updateEntityField } from '@/lib/engine/entities';
import { getStory } from '@/lib/engine/stories';
import { getUniverseVersion } from '@/lib/engine/universes';
import { fieldFormName } from '@/app/stories/[storyId]/entities/entity-fields/entity-schema-form';
import { parseEntityFormData } from '@/app/stories/[storyId]/entities/entity-fields/parse-form-data';

export type EntityActionState = {
  status: 'idle' | 'error';
  message?: string;
};

const initialIdle: EntityActionState = { status: 'idle' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/**
 * Create an entity of a schema-defined type using the dynamic form. The
 * story's pinned universe version supplies the field list used to reparse
 * `formData` back into `data` — same field list the form was rendered from.
 */
export async function createSchemaEntityAction(
  storyId: string,
  entityType: string,
  _prevState: EntityActionState,
  formData: FormData,
): Promise<EntityActionState> {
  const user = await requireUser();
  const name = formData.get('name');

  if (typeof name !== 'string' || name.trim().length === 0) {
    return { status: 'error', message: 'Name is required.' };
  }

  const story = await getStory(storyId, user.id);

  if (story.universeId === null || story.universeVersion === null) {
    return { status: 'error', message: 'This story has no pinned universe.' };
  }

  const universeVersion = await getUniverseVersion(story.universeId, story.universeVersion);
  const definition = universeVersion.entitySchema.entity_types[entityType];

  if (definition === undefined) {
    return { status: 'error', message: `Unknown entity type "${entityType}".` };
  }

  const data = parseEntityFormData(definition.fields, formData, fieldFormName);

  const parsed = entityInputSchema.safeParse({
    type: entityType,
    name,
    data,
    controlledBy: null,
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  try {
    await createEntity(storyId, user.id, parsed.data);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/entities`);
  return initialIdle;
}

/** Apply every field on the dynamic form in one write, replacing the whole `data` object. */
export async function updateSchemaEntityAction(
  storyId: string,
  entityId: string,
  _prevState: EntityActionState,
  formData: FormData,
): Promise<EntityActionState> {
  const user = await requireUser();
  const entity = await getEntity(entityId, user.id);
  const story = await getStory(storyId, user.id);

  if (story.universeId === null || story.universeVersion === null) {
    return { status: 'error', message: 'This story has no pinned universe.' };
  }

  const universeVersion = await getUniverseVersion(story.universeId, story.universeVersion);
  const definition = universeVersion.entitySchema.entity_types[entity.type];

  if (definition === undefined) {
    return { status: 'error', message: `Unknown entity type "${entity.type}".` };
  }

  const data = parseEntityFormData(definition.fields, formData, fieldFormName);

  try {
    for (const [field, value] of Object.entries(data)) {
      await updateEntityField(entityId, user.id, field, value);
    }
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/entities/${entityId}`);
  return initialIdle;
}

export async function createEntityAction(
  storyId: string,
  _prevState: EntityActionState,
  formData: FormData,
): Promise<EntityActionState> {
  const user = await requireUser();

  const parsed = entityInputSchema.safeParse({
    type: formData.get('type'),
    name: formData.get('name'),
    data: {},
    controlledBy: null,
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  try {
    await createEntity(storyId, user.id, parsed.data);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/entities`);
  return initialIdle;
}

/**
 * Apply one field edit from the raw-JSON editor. The value is parsed as JSON
 * when possible so numbers/booleans/objects round-trip; a plain string that
 * fails to parse is stored as a string, since `data` is opaque and the engine
 * has no business rejecting it.
 */
export async function updateEntityFieldAction(
  storyId: string,
  entityId: string,
  _prevState: EntityActionState,
  formData: FormData,
): Promise<EntityActionState> {
  const user = await requireUser();

  const field = formData.get('field');
  const rawValue = formData.get('value');

  if (typeof field !== 'string' || field.trim().length === 0) {
    return { status: 'error', message: 'Field name is required.' };
  }

  if (typeof rawValue !== 'string') {
    return { status: 'error', message: 'Value is required.' };
  }

  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    value = rawValue;
  }

  try {
    await updateEntityField(entityId, user.id, field.trim(), value);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}/entities/${entityId}`);
  return initialIdle;
}
