import 'server-only';

import { assertMember, requireRole } from '@/lib/engine/membership';
import { registeredPacingValues, resolveTurnMode } from '@/lib/engine/turn-modes';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Mid-story turn mode switching (Phase 7 — mode-switching capability).
 *
 * A switch only writes `stories.turn_config.active_mode` and an audit row —
 * it never touches any existing turn. `openTurn` reads `active_mode` fresh
 * at the moment a new turn is created (turns.ts), so a switch takes effect
 * starting with the next turn opened, with no separate "pending mode" state
 * to track. Two sequential service-role writes, not an RPC: this is a
 * low-frequency, owner/GM-only action with no concurrent-invariant to
 * protect, unlike turn opening's one-live-turn guard.
 */

export interface ModeChangeRecord {
  id: string;
  storyId: string;
  previousMode: string | null;
  newMode: string;
  changedBy: string | null;
  createdAt: string;
}

interface ModeChangeRow {
  id: string;
  story_id: string;
  previous_mode: string | null;
  new_mode: string;
  changed_by: string | null;
  created_at: string;
}

function toModeChangeRecord(row: ModeChangeRow): ModeChangeRecord {
  return {
    id: row.id,
    storyId: row.story_id,
    previousMode: row.previous_mode,
    newMode: row.new_mode,
    changedBy: row.changed_by,
    createdAt: row.created_at,
  };
}

const MODE_CHANGE_COLUMNS = 'id, story_id, previous_mode, new_mode, changed_by, created_at';

/**
 * Switch a story's active turn mode. Owner/GM only. Rejects an unregistered
 * mode name before writing anything, matching openTurn's own guard.
 */
export async function switchTurnMode(
  storyId: string,
  userId: string,
  newMode: string,
): Promise<ModeChangeRecord> {
  await requireRole(storyId, userId, ['owner', 'gm']);
  resolveTurnMode(newMode); // Reject an unregistered mode before writing.

  const supabase = createServiceRoleClient();

  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('turn_config')
    .eq('id', storyId)
    .single();

  if (storyError !== null) {
    throw new Error(`Failed to read story turn_config: ${storyError.message}`);
  }

  const turnConfig = (story.turn_config ?? {}) as Record<string, unknown>;
  const previousMode = typeof turnConfig.active_mode === 'string' ? turnConfig.active_mode : null;

  const { error: updateError } = await supabase
    .from('stories')
    .update({ turn_config: { ...turnConfig, active_mode: newMode } })
    .eq('id', storyId);

  if (updateError !== null) {
    throw new Error(`Failed to update story turn_config: ${updateError.message}`);
  }

  const { data, error: insertError } = await supabase
    .from('turn_mode_changes')
    .insert({
      story_id: storyId,
      previous_mode: previousMode,
      new_mode: newMode,
      changed_by: userId,
    })
    .select(MODE_CHANGE_COLUMNS)
    .single();

  if (insertError !== null) {
    throw new Error(`Failed to record turn mode change: ${insertError.message}`);
  }

  return toModeChangeRecord(data);
}

/**
 * Set a story's pacing preference (`turn_config.pacing`). Owner/GM only,
 * same authorization as switchTurnMode. No dedicated audit table — pacing is
 * a narrator-prompt styling knob, not a structural mode change, so it does
 * not warrant `turn_mode_changes`' history trail. Takes effect starting with
 * the next turn generated, since `generateTurn` reads it fresh each call.
 */
export async function setPacing(storyId: string, userId: string, pacing: string): Promise<void> {
  await requireRole(storyId, userId, ['owner', 'gm']);

  const registered = registeredPacingValues();
  if (!registered.includes(pacing)) {
    throw new Error(`Unknown pacing "${pacing}". Registered values: ${registered.join(', ')}.`);
  }

  const supabase = createServiceRoleClient();

  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('turn_config')
    .eq('id', storyId)
    .single();

  if (storyError !== null) {
    throw new Error(`Failed to read story turn_config: ${storyError.message}`);
  }

  const turnConfig = (story.turn_config ?? {}) as Record<string, unknown>;

  const { error: updateError } = await supabase
    .from('stories')
    .update({ turn_config: { ...turnConfig, pacing } })
    .eq('id', storyId);

  if (updateError !== null) {
    throw new Error(`Failed to update story turn_config: ${updateError.message}`);
  }
}

/** History of a story's mode switches, most recent first. Membership is
 * enforced by RLS's select policy for direct client reads; this service-role
 * helper mirrors that with an explicit check for callers that need it. */
export async function listModeChanges(storyId: string, userId: string): Promise<ModeChangeRecord[]> {
  await assertMember(storyId, userId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('turn_mode_changes')
    .select(MODE_CHANGE_COLUMNS)
    .eq('story_id', storyId)
    .order('created_at', { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to list turn mode changes: ${error.message}`);
  }

  return data.map(toModeChangeRecord);
}
