import 'server-only';

import { z } from 'zod';

import { entitySchemaSchema, type EntitySchema } from '@/lib/engine/schema';
import { resolveProgressionModel } from '@/lib/engine/progression-models';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * Universe and universe-version persistence.
 *
 * A universe is a named, owned, versioned container for an Entity Schema and
 * a Progression Model (build plan Part 2.4, Part 3). Versions are immutable —
 * `universe_versions` has no update policy — so every write here either
 * creates a universe's first version or appends the next one; nothing ever
 * mutates a published version in place (see universe-versioning spec).
 */

export const universeVersionInputSchema = z.object({
  name: z.string().trim().min(1, 'Universe name is required.').max(200, 'Name is too long.'),
  entitySchema: entitySchemaSchema,
  progressionModel: z.string().min(1),
  progressionConfig: z.record(z.string(), z.unknown()).default({}),
});

export type UniverseVersionInput = z.infer<typeof universeVersionInputSchema>;

export interface UniverseVersion {
  id: string;
  universeId: string;
  version: number;
  entitySchema: EntitySchema;
  progressionModel: string;
  progressionConfig: Record<string, unknown>;
  publishedAt: string;
}

interface UniverseVersionRow {
  id: string;
  universe_id: string;
  version: number;
  entity_schema: unknown;
  progression_model: string;
  progression_config: unknown;
  published_at: string;
}

function toUniverseVersion(row: UniverseVersionRow): UniverseVersion {
  return {
    id: row.id,
    universeId: row.universe_id,
    version: row.version,
    // Written only through this module, always parsed by entitySchemaSchema
    // first, so this cast reflects a real invariant rather than asserting one.
    entitySchema: (row.entity_schema ?? { entity_types: {} }) as EntitySchema,
    progressionModel: row.progression_model,
    progressionConfig: (row.progression_config ?? {}) as Record<string, unknown>,
    publishedAt: row.published_at,
  };
}

export interface Universe {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
}

interface UniverseRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
}

function toUniverse(row: UniverseRow): Universe {
  return { id: row.id, ownerId: row.owner_id, name: row.name, createdAt: row.created_at };
}

export class UniverseNotFoundError extends Error {
  constructor(readonly universeId: string) {
    super(`Universe ${universeId} not found.`);
    this.name = 'UniverseNotFoundError';
  }
}

export class UniverseVersionNotFoundError extends Error {
  constructor(
    readonly universeId: string,
    readonly version: number,
  ) {
    super(`Universe ${universeId} has no version ${version}.`);
    this.name = 'UniverseVersionNotFoundError';
  }
}

/**
 * Create a universe and publish its first version in one transaction.
 * Rejects unregistered progression models before any database write — a
 * universe naming a model the engine has no dispatch entry for could never
 * run a turn.
 */
export async function createUniverse(
  ownerId: string,
  input: UniverseVersionInput,
): Promise<UniverseVersion> {
  const parsed = universeVersionInputSchema.parse(input);
  resolveProgressionModel(parsed.progressionModel);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('create_universe_with_version', {
    p_owner_id: ownerId,
    p_name: parsed.name,
    p_entity_schema: toJson(parsed.entitySchema),
    p_progression_model: parsed.progressionModel,
    p_progression_config: toJson(parsed.progressionConfig),
  });

  if (error !== null || data === null) {
    throw new Error(`Failed to create universe: ${error?.message ?? 'no row returned'}`);
  }

  return toUniverseVersion(data as unknown as UniverseVersionRow);
}

/**
 * Publish the next version of an existing universe. The prior version's row
 * is never touched — see universe-versioning spec, "Immutable versions".
 */
export async function publishUniverseVersion(
  universeId: string,
  ownerId: string,
  input: UniverseVersionInput,
): Promise<UniverseVersion> {
  const parsed = universeVersionInputSchema.parse(input);
  resolveProgressionModel(parsed.progressionModel);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('publish_universe_version', {
    p_universe_id: universeId,
    p_owner_id: ownerId,
    p_entity_schema: toJson(parsed.entitySchema),
    p_progression_model: parsed.progressionModel,
    p_progression_config: toJson(parsed.progressionConfig),
  });

  if (error !== null || data === null) {
    throw new Error(`Failed to publish universe version: ${error?.message ?? 'no row returned'}`);
  }

  return toUniverseVersion(data as unknown as UniverseVersionRow);
}

export async function getUniverse(universeId: string): Promise<Universe> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('universes')
    .select('id, owner_id, name, created_at')
    .eq('id', universeId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read universe: ${error.message}`);
  }

  if (data === null) {
    throw new UniverseNotFoundError(universeId);
  }

  return toUniverse(data);
}

export async function getUniverseVersion(
  universeId: string,
  version: number,
): Promise<UniverseVersion> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('universe_versions')
    .select('id, universe_id, version, entity_schema, progression_model, progression_config, published_at')
    .eq('universe_id', universeId)
    .eq('version', version)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read universe version: ${error.message}`);
  }

  if (data === null) {
    throw new UniverseVersionNotFoundError(universeId, version);
  }

  return toUniverseVersion(data);
}

/** Highest published version for a universe. Used when pinning a new story. */
export async function getLatestUniverseVersion(universeId: string): Promise<UniverseVersion> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('universe_versions')
    .select('id, universe_id, version, entity_schema, progression_model, progression_config, published_at')
    .eq('universe_id', universeId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read latest universe version: ${error.message}`);
  }

  if (data === null) {
    throw new UniverseNotFoundError(universeId);
  }

  return toUniverseVersion(data);
}
