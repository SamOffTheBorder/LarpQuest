import 'server-only';

import { requireRole } from '@/lib/engine/membership';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * GM/owner overrides (canon-exceptions capability).
 *
 * An override never edits or deletes the flag or proposal it responds to —
 * it writes an additional, permanent `canon_exceptions` row, the same
 * append-only, non-destructive pattern `entity_history` already uses. The
 * rule engine and Gatekeeper both check these rows before re-flagging the
 * same rule/entity/capability combination (rules/exceptions.ts's
 * `isSuppressed`, shared by both).
 */

export interface CanonExceptionRecord {
  id: string;
  storyId: string;
  ruleId: string;
  entityId: string | null;
  capabilityId: string | null;
  exceptionNote: string;
  createdBy: string | null;
  createdAt: string;
}

interface CanonExceptionRow {
  id: string;
  story_id: string;
  rule_id: string;
  entity_id: string | null;
  capability_id: string | null;
  exception_note: string;
  created_by: string | null;
  created_at: string;
}

function toCanonException(row: CanonExceptionRow): CanonExceptionRecord {
  return {
    id: row.id,
    storyId: row.story_id,
    ruleId: row.rule_id,
    entityId: row.entity_id,
    capabilityId: row.capability_id,
    exceptionNote: row.exception_note,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const CANON_EXCEPTION_COLUMNS =
  'id, story_id, rule_id, entity_id, capability_id, exception_note, created_by, created_at';

export class ChapterNotFoundError extends Error {
  constructor(readonly chapterId: string) {
    super(`Chapter ${chapterId} not found.`);
    this.name = 'ChapterNotFoundError';
  }
}

export class ProposalNotFoundError extends Error {
  constructor(readonly proposalId: string) {
    super(`Proposal ${proposalId} not found.`);
    this.name = 'ProposalNotFoundError';
  }
}

export class EmptyExceptionNoteError extends Error {
  constructor() {
    super('An override requires a stated reason.');
    this.name = 'EmptyExceptionNoteError';
  }
}

export interface ExceptionScope {
  entityId?: string | null;
  capabilityId?: string | null;
}

async function insertCanonException(
  storyId: string,
  userId: string,
  ruleId: string,
  scope: ExceptionScope,
  exceptionNote: string,
): Promise<CanonExceptionRecord> {
  await requireRole(storyId, userId, ['owner', 'gm']);

  const trimmedNote = exceptionNote.trim();
  if (trimmedNote.length === 0) {
    throw new EmptyExceptionNoteError();
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('canon_exceptions')
    .insert({
      story_id: storyId,
      rule_id: ruleId,
      entity_id: scope.entityId ?? null,
      capability_id: scope.capabilityId ?? null,
      exception_note: trimmedNote,
      created_by: userId,
    })
    .select(CANON_EXCEPTION_COLUMNS)
    .single();

  if (error !== null) {
    throw new Error(`Failed to write canon exception: ${error.message}`);
  }

  return toCanonException(data);
}

/**
 * Override a validation flag on a published chapter. The chapter's
 * `validation_report` is never touched — this only adds a `canon_exceptions`
 * row scoped to `ruleId` (and, optionally, an entity/capability), which
 * future rule-engine evaluations check before re-flagging the same thing.
 */
export async function overrideValidationFlag(
  chapterId: string,
  userId: string,
  ruleId: string,
  scope: ExceptionScope,
  exceptionNote: string,
): Promise<CanonExceptionRecord> {
  const supabase = createServiceRoleClient();
  const { data: chapter, error } = await supabase
    .from('chapters')
    .select('story_id')
    .eq('id', chapterId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read chapter: ${error.message}`);
  }

  if (chapter === null) {
    throw new ChapterNotFoundError(chapterId);
  }

  return insertCanonException(chapter.story_id, userId, ruleId, scope, exceptionNote);
}

/**
 * Override a Gatekeeper verdict on a proposal. Writes the canon exception
 * and separately flips the proposal's `gm_override` to true — the
 * proposal's original `verdict`/`reasoning` are never altered, so the
 * history of what the Gatekeeper actually ruled stays intact.
 */
export async function overrideProposal(
  proposalId: string,
  userId: string,
  exceptionNote: string,
): Promise<CanonExceptionRecord> {
  const supabase = createServiceRoleClient();
  const { data: proposal, error } = await supabase
    .from('proposals')
    .select('story_id, entity_id')
    .eq('id', proposalId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read proposal: ${error.message}`);
  }

  if (proposal === null) {
    throw new ProposalNotFoundError(proposalId);
  }

  const exception = await insertCanonException(
    proposal.story_id,
    userId,
    'gatekeeper.proposal',
    { entityId: proposal.entity_id },
    exceptionNote,
  );

  const { error: updateError } = await supabase
    .from('proposals')
    .update({ gm_override: true })
    .eq('id', proposalId);

  if (updateError !== null) {
    throw new Error(`Failed to mark proposal overridden: ${updateError.message}`);
  }

  return exception;
}
