import 'server-only';

import { assertMember, requireRole } from '@/lib/engine/membership';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Entity claiming. `entities.controlled_by` is a real, enforced field — a
 * player claims an entity to submit actions for it, and only its controller
 * (or a GM) may submit on its behalf. See entity-claiming spec.
 */

export class EntityNotFoundError extends Error {
  constructor(readonly entityId: string) {
    super(`Entity ${entityId} not found.`);
    this.name = 'EntityNotFoundError';
  }
}

export class EntityAlreadyControlledError extends Error {
  constructor(
    readonly entityId: string,
    readonly controlledBy: string,
  ) {
    super(`Entity ${entityId} is already controlled by ${controlledBy}.`);
    this.name = 'EntityAlreadyControlledError';
  }
}

interface EntityControlRow {
  story_id: string;
  controlled_by: string | null;
}

async function loadEntityControl(entityId: string): Promise<EntityControlRow> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('entities')
    .select('story_id, controlled_by')
    .eq('id', entityId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read entity: ${error.message}`);
  }

  if (data === null) {
    throw new EntityNotFoundError(entityId);
  }

  return data;
}

/** A player claims an unclaimed entity. Rejected if already controlled by someone else. */
export async function claimEntity(entityId: string, userId: string): Promise<void> {
  const entity = await loadEntityControl(entityId);
  await assertMember(entity.story_id, userId);

  if (entity.controlled_by !== null && entity.controlled_by !== userId) {
    throw new EntityAlreadyControlledError(entityId, entity.controlled_by);
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('entities')
    .update({ controlled_by: userId })
    .eq('id', entityId);

  if (error !== null) {
    throw new Error(`Failed to claim entity: ${error.message}`);
  }
}

/** The controller (or a GM/owner) releases a claim, leaving the entity unclaimed. */
export async function releaseEntity(entityId: string, userId: string): Promise<void> {
  const entity = await loadEntityControl(entityId);

  if (entity.controlled_by !== userId) {
    await requireRole(entity.story_id, userId, ['owner', 'gm']);
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('entities')
    .update({ controlled_by: null })
    .eq('id', entityId);

  if (error !== null) {
    throw new Error(`Failed to release entity: ${error.message}`);
  }
}

/** GM/owner only. May override an existing controller. */
export async function reassignEntity(
  entityId: string,
  actingUserId: string,
  newControllerId: string | null,
): Promise<void> {
  const entity = await loadEntityControl(entityId);
  await requireRole(entity.story_id, actingUserId, ['owner', 'gm']);

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('entities')
    .update({ controlled_by: newControllerId })
    .eq('id', entityId);

  if (error !== null) {
    throw new Error(`Failed to reassign entity: ${error.message}`);
  }
}
