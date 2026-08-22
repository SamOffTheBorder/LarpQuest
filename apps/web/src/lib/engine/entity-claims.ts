import 'server-only';

import { assertMember, requireRole } from '@/lib/engine/membership';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Entity control. `entities.controlled_by` is a real, enforced field — only an
 * entity's controller (or a GM) may submit actions on its behalf.
 *
 * Control is granted by the GM, not taken: the GM casts the story, assigning
 * characters to players and to themselves. A player may release a character
 * they hold, but cannot pick one up unilaterally.
 */

export class EntityNotFoundError extends Error {
  constructor(readonly entityId: string) {
    super(`Entity ${entityId} not found.`);
    this.name = 'EntityNotFoundError';
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

/**
 * The controller (or a GM/owner) releases a claim, leaving the entity
 * unclaimed. A player can always put a character down; only a GM can hand one
 * out (see assignEntity).
 */
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

/**
 * GM/owner assigns a character to a member — the only way control is granted.
 * Players do not self-claim: the GM casts the story, including casting
 * themselves (passing their own id is ordinary, not a special case).
 *
 * May override an existing controller, so a GM can recast without asking the
 * current player to release first. Passing null unassigns.
 */
export async function assignEntity(
  entityId: string,
  actingUserId: string,
  newControllerId: string | null,
): Promise<void> {
  const entity = await loadEntityControl(entityId);
  await requireRole(entity.story_id, actingUserId, ['owner', 'gm']);

  // The target must be in the story; otherwise a character could be assigned
  // to a stranger, or to someone who has since left.
  if (newControllerId !== null) {
    await assertMember(entity.story_id, newControllerId);
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('entities')
    .update({ controlled_by: newControllerId })
    .eq('id', entityId);

  if (error !== null) {
    throw new Error(`Failed to assign entity: ${error.message}`);
  }
}
