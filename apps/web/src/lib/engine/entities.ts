import 'server-only';

import { z } from 'zod';

import type { EntityData } from '@/lib/engine/context';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';
import { assertMember } from '@/lib/engine/membership';
import { buildEntityDataValidator } from '@/lib/engine/schema';
import { resolveProgressionModel } from '@/lib/engine/progression-models';
import { getUniverseVersion, type UniverseVersion } from '@/lib/engine/universes';

/**
 * Entity persistence.
 *
 * `data` is opaque by default. When the owning story has no pinned universe
 * version, nothing here validates, constrains, or branches on `data`'s
 * contents — that is what lets one engine run every genre. When a story does
 * have a pinned version, writes are validated against that version's entity
 * schema (see entity-schema spec) before they reach the database — but the
 * dispatch is on the schema's bounded field-type vocabulary, never on the
 * universe, genre, or media type itself.
 *
 * Writes go through database functions so the entity row and its history row
 * move together. A history write that fails takes the update with it.
 */

export class SchemaValidationError extends Error {
  constructor(entityType: string, issues: string) {
    super(`Entity data for type "${entityType}" does not match its schema: ${issues}`);
    this.name = 'SchemaValidationError';
  }
}

export class InvalidCapabilityTransitionError extends Error {
  constructor(field: string, from: unknown, to: unknown) {
    super(
      `Invalid transition on "${field}": ${JSON.stringify(from)} -> ${JSON.stringify(to)} is not allowed by this universe's progression model.`,
    );
    this.name = 'InvalidCapabilityTransitionError';
  }
}

async function getPinnedUniverseVersion(storyId: string): Promise<UniverseVersion | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('stories')
    .select('universe_id, universe_version')
    .eq('id', storyId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read story's pinned universe: ${error.message}`);
  }

  if (data === null || data.universe_id === null || data.universe_version === null) {
    return null;
  }

  return getUniverseVersion(data.universe_id, data.universe_version);
}

/** Validates `data` against the pinned version's schema. No-op with no pin. */
async function validateAgainstPinnedSchema(
  storyId: string,
  entityType: string,
  data: EntityData,
): Promise<void> {
  const universeVersion = await getPinnedUniverseVersion(storyId);

  if (universeVersion === null) {
    return;
  }

  const validator = buildEntityDataValidator(universeVersion.entitySchema, entityType);
  const result = validator.safeParse(data);

  if (!result.success) {
    throw new SchemaValidationError(entityType, result.error.message);
  }
}

export const entityInputSchema = z.object({
  type: z.string().min(1, 'Entity type is required.'),
  name: z.string().trim().min(1, 'Entity name is required.'),
  /** Opaque. Never inspected by the engine. */
  data: z.record(z.string(), z.unknown()).default({}),
  controlledBy: z.string().uuid().nullable().default(null),
});

export type EntityInput = z.infer<typeof entityInputSchema>;

export interface Entity {
  id: string;
  storyId: string;
  type: string;
  name: string;
  status: string;
  data: EntityData;
  controlledBy: string | null;
  updatedAt: string;
}

interface EntityRow {
  id: string;
  story_id: string;
  type: string;
  name: string;
  status: string;
  data: unknown;
  controlled_by: string | null;
  updated_at: string;
}

function toEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    storyId: row.story_id,
    type: row.type,
    name: row.name,
    status: row.status,
    // jsonb always round-trips as an object here; the cast keeps `data` opaque
    // rather than asserting any shape on it.
    data: (row.data ?? {}) as EntityData,
    controlledBy: row.controlled_by,
    updatedAt: row.updated_at,
  };
}

export class EntityNotFoundError extends Error {
  constructor(readonly entityId: string) {
    super(`Entity ${entityId} not found.`);
    this.name = 'EntityNotFoundError';
  }
}

/** List a story's entities. Membership is checked before any read. */
export async function listEntities(storyId: string, userId: string): Promise<Entity[]> {
  await assertMember(storyId, userId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('entities')
    .select('id, story_id, type, name, status, data, controlled_by, updated_at')
    .eq('story_id', storyId)
    .order('name');

  if (error !== null) {
    throw new Error(`Failed to list entities: ${error.message}`);
  }

  return data.map(toEntity);
}

export async function getEntity(entityId: string, userId: string): Promise<Entity> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('entities')
    .select('id, story_id, type, name, status, data, controlled_by, updated_at')
    .eq('id', entityId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read entity: ${error.message}`);
  }

  if (data === null) {
    throw new EntityNotFoundError(entityId);
  }

  await assertMember(data.story_id, userId);

  return toEntity(data);
}

/**
 * Create an entity, seeding its history with the creating record.
 *
 * A missing name is rejected by the schema before any database work.
 */
export async function createEntity(
  storyId: string,
  userId: string,
  input: EntityInput,
): Promise<Entity> {
  await assertMember(storyId, userId);

  const parsed = entityInputSchema.parse(input);
  await validateAgainstPinnedSchema(storyId, parsed.type, parsed.data);

  const supabase = createServiceRoleClient();

  // Nullable RPC params are generated as optional rather than `| null`, so an
  // absent value is omitted rather than passed as null.
  const { data, error } = await supabase.rpc('create_entity_with_history', {
    p_story_id: storyId,
    p_type: parsed.type,
    p_name: parsed.name,
    p_data: toJson(parsed.data),
    p_created_by: userId,
    ...(parsed.controlledBy !== null ? { p_controlled_by: parsed.controlledBy } : {}),
  });

  if (error !== null || data === null) {
    throw new Error(`Failed to create entity: ${error?.message ?? 'no row returned'}`);
  }

  return toEntity(data as unknown as EntityRow);
}

/**
 * Apply a manual field edit, writing history with the acting user and a null
 * chapter reference. Extracted diffs take the same path with a chapter id.
 */
export async function updateEntityField(
  entityId: string,
  userId: string,
  field: string,
  value: unknown,
  evidence = 'Manual edit',
): Promise<Entity> {
  const current = await getEntity(entityId, userId);
  const nextData: EntityData = { ...current.data, [field]: value };

  const universeVersion = await getPinnedUniverseVersion(current.storyId);

  if (universeVersion !== null) {
    const validator = buildEntityDataValidator(universeVersion.entitySchema, current.type);
    const result = validator.safeParse(nextData);

    if (!result.success) {
      throw new SchemaValidationError(current.type, result.error.message);
    }

    const fieldDef = universeVersion.entitySchema.entity_types[current.type]?.fields.find(
      (candidate) => candidate.key === field,
    );
    const model = resolveProgressionModel(universeVersion.progressionModel);

    if (fieldDef !== undefined && model.validateTransition !== undefined) {
      const previousItems = Array.isArray(current.data[field]) ? (current.data[field] as { id: unknown; status: unknown }[]) : [];
      const nextItems = Array.isArray(value) ? (value as { id: unknown; status: unknown }[]) : [];

      for (const nextItem of nextItems) {
        const previousItem = previousItems.find((item) => item.id === nextItem.id);
        const fromStatus = previousItem?.status;
        const toStatus = nextItem.status;

        if (fromStatus !== undefined && fromStatus !== toStatus) {
          const allowed = model.validateTransition(fieldDef, fromStatus, toStatus);

          if (!allowed) {
            throw new InvalidCapabilityTransitionError(field, fromStatus, toStatus);
          }
        }
      }
    }
  }

  const supabase = createServiceRoleClient();

  // p_chapter_id is omitted rather than passed as null: a manual edit has no
  // originating chapter, which the database records as null by default.
  const { data, error } = await supabase.rpc('apply_entity_update', {
    p_entity_id: entityId,
    p_data: toJson(nextData),
    p_diff: toJson({
      entity_id: entityId,
      field,
      from: current.data[field] ?? null,
      to: value ?? null,
      evidence,
    }),
    p_applied_by: userId,
    p_is_reversal: false,
  });

  if (error !== null || data === null) {
    throw new Error(`Failed to update entity: ${error?.message ?? 'no row returned'}`);
  }

  return toEntity(data as unknown as EntityRow);
}
