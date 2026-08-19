import 'server-only';

import { lockTurn } from '@/lib/engine/turns';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Deadline-triggered turn locking (build plan 7.2/7.4's absent-player
 * policy). A scheduled sweep, not a DB trigger — matches every other
 * async/scheduled concern in this codebase (extraction, memory), and
 * `ai_plays` needs to enumerate claimed entities and write placeholder
 * submissions, which belongs in application code.
 *
 * The sweep is not acting on behalf of any one user — it writes placeholder
 * submissions directly (attributed to each unsubmitted entity's own
 * controller, not a synthetic "system" account, since submissions.user_id
 * has no row to reference for one) rather than going through
 * turns.ts's createSubmission, which requires a real member. Locking still
 * funnels through the same lockTurn() a GM uses manually (source:
 * 'deadline'), so there is exactly one code path that transitions a turn
 * from open to locked.
 */

type AbsentPolicy = 'skip' | 'ai_plays' | 'block';

function readAbsentPolicy(turnConfig: unknown): AbsentPolicy {
  if (turnConfig === null || typeof turnConfig !== 'object') {
    return 'skip';
  }

  const value = (turnConfig as Record<string, unknown>).absent_policy;
  return value === 'ai_plays' || value === 'block' ? value : 'skip';
}

interface DueTurnRow {
  id: string;
  story_id: string;
}

export interface DeadlineSweepOutcome {
  checked: number;
  locked: number;
  blocked: number;
}

/**
 * Lock every open turn whose deadline has passed, per its story's
 * absent_policy. Turns with no deadline set are untouched.
 */
export async function sweepDeadlines(): Promise<DeadlineSweepOutcome> {
  const supabase = createServiceRoleClient();

  const { data: dueTurns, error } = await supabase
    .from('turns')
    .select('id, story_id')
    .eq('status', 'open')
    .not('deadline', 'is', null)
    .lt('deadline', new Date().toISOString());

  if (error !== null) {
    throw new Error(`Failed to query due turns: ${error.message}`);
  }

  const outcome: DeadlineSweepOutcome = { checked: dueTurns.length, locked: 0, blocked: 0 };

  for (const turn of dueTurns as DueTurnRow[]) {
    const locked = await processDueTurn(turn);

    if (locked) {
      outcome.locked += 1;
    } else {
      outcome.blocked += 1;
    }
  }

  return outcome;
}

/** Returns true if the turn was locked, false if left open (block policy, or nothing to lock). */
async function processDueTurn(turn: DueTurnRow): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const [storyResult, ownerResult] = await Promise.all([
    supabase.from('stories').select('turn_config').eq('id', turn.story_id).single(),
    supabase.from('story_members').select('user_id').eq('story_id', turn.story_id).eq('role', 'owner').single(),
  ]);

  if (storyResult.error !== null) {
    throw new Error(`Failed to read story turn_config: ${storyResult.error.message}`);
  }

  if (ownerResult.error !== null) {
    throw new Error(`Failed to read story owner: ${ownerResult.error.message}`);
  }

  const absentPolicy = readAbsentPolicy(storyResult.data.turn_config);

  if (absentPolicy === 'block') {
    return false;
  }

  if (absentPolicy === 'ai_plays') {
    await createPlaceholderSubmissions(turn.id, turn.story_id);
  }

  try {
    // The owner is always a member, so lockTurn's assertMember check passes
    // regardless of who is actually online — the sweep is not acting on
    // behalf of any one user, and 'deadline' source already exempts it from
    // the manual-lock role check.
    await lockTurn(turn.id, ownerResult.data.user_id, { source: 'deadline' });
    return true;
  } catch {
    // Lock-with-no-submissions guard still applies under both skip and
    // ai_plays (e.g. a story with zero claimed entities and zero
    // submissions) — the turn simply stays open past its deadline.
    return false;
  }
}

/**
 * Fixed-template placeholder, not a model call: the common case (an absent
 * player) does not need generated prose, only a submission the Narrator can
 * read as "this character took no deliberate action." Attributed to the
 * entity's own controller — a real member — rather than a synthetic system
 * user, since submissions.user_id references auth.users and there is no such
 * row for "the system." Writes the row directly rather than through
 * turns.ts's createSubmission: the controller check there would be a
 * redundant round-trip (the entity is claimed by this exact user by
 * definition) and the sweep has no session to act as that user under.
 */
async function createPlaceholderSubmissions(turnId: string, storyId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const [entitiesResult, submissionsResult] = await Promise.all([
    supabase
      .from('entities')
      .select('id, name, controlled_by')
      .eq('story_id', storyId)
      .not('controlled_by', 'is', null),
    supabase.from('submissions').select('entity_id').eq('turn_id', turnId),
  ]);

  if (entitiesResult.error !== null) {
    throw new Error(`Failed to read claimed entities: ${entitiesResult.error.message}`);
  }

  if (submissionsResult.error !== null) {
    throw new Error(`Failed to read existing submissions: ${submissionsResult.error.message}`);
  }

  const submittedEntityIds = new Set(submissionsResult.data.map((row) => row.entity_id));
  // The .not('controlled_by', 'is', null) filter above guarantees this at
  // runtime; the query builder's return type doesn't narrow on it.
  const unsubmitted = entitiesResult.data.filter(
    (entity): entity is typeof entity & { controlled_by: string } =>
      entity.controlled_by !== null && !submittedEntityIds.has(entity.id),
  );

  for (const entity of unsubmitted) {
    const { error } = await supabase.from('submissions').insert({
      turn_id: turnId,
      story_id: storyId,
      user_id: entity.controlled_by,
      entity_id: entity.id,
      content: `${entity.name} waits, taking no deliberate action this turn.`,
    });

    if (error !== null) {
      throw new Error(`Failed to create placeholder submission: ${error.message}`);
    }
  }
}
