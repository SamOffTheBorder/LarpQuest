import 'server-only';

import { z } from 'zod';

import { streamNarration } from '@/lib/ai/gateway';
import type { ModelConfig } from '@/lib/ai/roles';
import { createBudgetGuard } from '@/lib/ai/spend';
import { createUsageRecorder } from '@/lib/ai/usage';
import { newFenceNonce } from '@/lib/ai/untrusted';
import {
  assembleContext,
  DEFAULT_CONTEXT_POLICY as ENGINE_DEFAULT_CONTEXT_POLICY,
  type ContextChapter,
  type ContextEntity,
  type ContextPolicy,
} from '@/lib/engine/context';
import { evaluateProposal } from '@/lib/engine/gatekeeper';
import { assertMember, requireRole } from '@/lib/engine/membership';
import { DEFAULT_PROGRESSION_MODEL } from '@/lib/engine/progression-models';
import { ruleSchema, type CanonException, type Rule } from '@/lib/engine/rules/types';
import {
  extractTurningPoint,
  isTurningPointEligible,
  readActiveMode,
  readPacing,
  resolveTurnMode,
} from '@/lib/engine/turn-modes';
import { acceptsSubmissions, assertTransition, type TurnStatus } from '@/lib/engine/turn-state';
import {
  buildBlockRetryAddendum,
  loadCanonExceptions,
  runValidation,
  toValidationReportJson,
} from '@/lib/engine/validator';
import type { ContextPolicy as StoredContextPolicy } from '@/lib/memory/schemas';
import { retrieveRelevantSummaries } from '@/lib/memory/retrieval';
import { moderateTurnSubmissions } from '@/lib/moderation/moderate';
import { resolveStoryApiKey } from '@/lib/ai/api-key';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * The turn loop.
 *
 * open -> locked -> generating -> published, with failed as a first-class
 * retryable state. Two rules govern everything here:
 *
 *   1. Submissions persist independently of generation. No outcome deletes or
 *      alters one, so a failed turn is always retryable with the originals.
 *   2. Publication never waits on extraction. `publish_chapter` commits the
 *      chapter and only ENQUEUES extraction; the worker runs separately.
 */

export interface Turn {
  id: string;
  storyId: string;
  turnNumber: number;
  mode: string;
  sceneSetup: string | null;
  status: TurnStatus;
  partialProse: string | null;
  failureReason: string | null;
  attemptCount: number;
  /** Set when this turn is a fight-chapter-split continuation, referencing
   * the chapter it continues. Null for every ordinary turn. */
  continuesChapterId: string | null;
}

interface TurnRow {
  id: string;
  story_id: string;
  turn_number: number;
  mode: string;
  scene_setup: string | null;
  status: string;
  partial_prose: string | null;
  failure_reason: string | null;
  attempt_count: number;
  continues_chapter_id: string | null;
}

function toTurn(row: TurnRow): Turn {
  return {
    id: row.id,
    storyId: row.story_id,
    turnNumber: row.turn_number,
    mode: row.mode,
    sceneSetup: row.scene_setup,
    status: row.status as TurnStatus,
    partialProse: row.partial_prose,
    failureReason: row.failure_reason,
    attemptCount: row.attempt_count,
    continuesChapterId: row.continues_chapter_id,
  };
}

const TURN_COLUMNS =
  'id, story_id, turn_number, mode, scene_setup, status, partial_prose, failure_reason, attempt_count, continues_chapter_id';

export class TurnNotFoundError extends Error {
  constructor(readonly turnId: string) {
    super(`Turn ${turnId} not found.`);
    this.name = 'TurnNotFoundError';
  }
}

export class TurnStateError extends Error {
  constructor(
    readonly turnId: string,
    readonly status: TurnStatus,
    detail: string,
  ) {
    super(`Turn ${turnId} is ${status}: ${detail}`);
    this.name = 'TurnStateError';
  }
}

export class LiveTurnExistsError extends Error {
  constructor(readonly storyId: string) {
    super(`Story ${storyId} already has a turn that is not published.`);
    this.name = 'LiveTurnExistsError';
  }
}

export class TurnBlockedByModerationError extends Error {
  constructor(
    readonly turnId: string,
    readonly reason: string,
  ) {
    super(`Turn ${turnId} was blocked by moderation: ${reason}`);
    this.name = 'TurnBlockedByModerationError';
  }
}

export class NotEntityControllerError extends Error {
  constructor(
    readonly entityId: string,
    readonly userId: string,
  ) {
    super(`User ${userId} does not control entity ${entityId} and is not owner or GM.`);
    this.name = 'NotEntityControllerError';
  }
}

/**
 * A submission targeting an entity may only be made by that entity's
 * controller, or by owner/gm — who may submit on behalf of an unclaimed or
 * absent-player entity, per build plan 7.4.
 *
 * An unclaimed entity is GM-only rather than open to any member: control is
 * granted by the GM (see entity-claims), so letting a player act for a
 * character they were never cast in would route around that entirely.
 */
async function assertCanSubmitForEntity(
  storyId: string,
  userId: string,
  entityId: string | null,
): Promise<void> {
  if (entityId === null) {
    return;
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('entities')
    .select('controlled_by')
    .eq('id', entityId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read entity controller: ${error.message}`);
  }

  const controlledBy = data?.controlled_by ?? null;

  if (controlledBy === userId) {
    return;
  }

  if (await hasRoleInStory(storyId, userId, ['owner', 'gm'])) {
    return;
  }

  throw new NotEntityControllerError(entityId, userId);
}

async function hasRoleInStory(storyId: string, userId: string, allowed: readonly string[]): Promise<boolean> {
  try {
    await requireRole(storyId, userId, allowed as ('owner' | 'gm' | 'player' | 'spectator')[]);
    return true;
  } catch {
    return false;
  }
}

async function loadTurn(turnId: string): Promise<Turn> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('turns')
    .select(TURN_COLUMNS)
    .eq('id', turnId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read turn: ${error.message}`);
  }

  if (data === null) {
    throw new TurnNotFoundError(turnId);
  }

  return toTurn(data);
}

/* ------------------------------------------------------------------ *
 * 7.2  Open
 * ------------------------------------------------------------------ */

/**
 * Open a turn. The database function holds the one-live-turn invariant, so a
 * concurrent second open loses rather than creating a duplicate.
 */
export async function openTurn(
  storyId: string,
  userId: string,
  options: { mode?: string; sceneSetup?: string | null } = {},
): Promise<Turn> {
  await requireRole(storyId, userId, ['owner', 'gm']);

  const supabase = createServiceRoleClient();

  let mode = options.mode;
  if (mode === undefined) {
    const { data: story, error: storyError } = await supabase
      .from('stories')
      .select('turn_config')
      .eq('id', storyId)
      .single();

    if (storyError !== null) {
      throw new Error(`Failed to read story turn_config: ${storyError.message}`);
    }

    mode = readActiveMode(story.turn_config);
  }
  resolveTurnMode(mode); // Reject an unregistered mode before writing.

  const sceneSetup = options.sceneSetup ?? null;

  // Nullable RPC params are generated as optional rather than `| null`.
  const { data, error } = await supabase.rpc('open_turn', {
    p_story_id: storyId,
    p_mode: mode,
    ...(sceneSetup !== null ? { p_scene_setup: sceneSetup } : {}),
  });

  if (error !== null) {
    // Both the advisory-lock guard and the partial unique index surface as
    // unique violations.
    if (error.code === '23505' || error.message.includes('already has a live turn')) {
      throw new LiveTurnExistsError(storyId);
    }

    throw new Error(`Failed to open turn: ${error.message}`);
  }

  if (data === null) {
    throw new Error('Failed to open turn: no row returned.');
  }

  return toTurn(data as unknown as TurnRow);
}

/** The story's current non-published turn, if any. Read-only, for the UI. */
export async function getLiveTurn(storyId: string, userId: string): Promise<Turn | null> {
  await assertMember(storyId, userId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('turns')
    .select(TURN_COLUMNS)
    .eq('story_id', storyId)
    .neq('status', 'published')
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read live turn: ${error.message}`);
  }

  return data === null ? null : toTurn(data);
}

export async function getTurn(turnId: string, userId: string): Promise<Turn> {
  const turn = await loadTurn(turnId);
  await assertMember(turn.storyId, userId);
  return turn;
}

/* ------------------------------------------------------------------ *
 * 7.3  Submissions
 * ------------------------------------------------------------------ */

export const submissionInputSchema = z.object({
  content: z.string().trim().min(1, 'A submission cannot be empty.'),
  entityId: z.string().uuid().nullable().default(null),
  /** A request for something new — a capability, an alliance, a plot
   * development — the submitting entity does not yet have (build plan 5.4).
   * Optional: most submissions are plain action/dialogue with no proposal.
   * Evaluated by the Gatekeeper capability before the Narrator runs. */
  proposal: z.string().trim().min(1).nullable().optional(),
});

export type SubmissionInput = z.infer<typeof submissionInputSchema>;

export interface Submission {
  id: string;
  turnId: string;
  /**
   * Null when the submitting account has since been deleted. The submission
   * itself is preserved regardless (CLAUDE.md #4) — this only means it can no
   * longer be attributed to a live account.
   */
  userId: string | null;
  entityId: string | null;
  content: string;
  proposal: string | null;
}

interface SubmissionRow {
  id: string;
  turn_id: string;
  user_id: string | null;
  entity_id: string | null;
  content: string;
  proposals: unknown;
}

/** proposals is opaque jsonb, written only as {text: string} by this module. */
function toSubmission(row: SubmissionRow): Submission {
  const proposals = row.proposals as { text?: unknown } | null;
  const proposal = typeof proposals?.text === 'string' ? proposals.text : null;

  return {
    id: row.id,
    turnId: row.turn_id,
    userId: row.user_id,
    entityId: row.entity_id,
    content: row.content,
    proposal,
  };
}

/** Create a submission. Rejected unless the turn is open. */
export async function createSubmission(
  turnId: string,
  userId: string,
  input: SubmissionInput,
): Promise<Submission> {
  const parsed = submissionInputSchema.parse(input);
  const turn = await loadTurn(turnId);
  await assertMember(turn.storyId, userId);

  if (!acceptsSubmissions(turn.status)) {
    throw new TurnStateError(turnId, turn.status, 'submissions are only accepted while open.');
  }

  await assertCanSubmitForEntity(turn.storyId, userId, parsed.entityId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('submissions')
    .insert({
      turn_id: turnId,
      story_id: turn.storyId,
      user_id: userId,
      entity_id: parsed.entityId,
      content: parsed.content,
      proposals: parsed.proposal === null || parsed.proposal === undefined ? null : toJson({ text: parsed.proposal }),
    })
    .select('id, turn_id, user_id, entity_id, content, proposals')
    .single();

  if (error !== null) {
    throw new Error(`Failed to create submission: ${error.message}`);
  }

  return toSubmission(data);
}

/** Edit a submission. Only its author, and only while the turn is open. */
export async function updateSubmission(
  submissionId: string,
  userId: string,
  input: SubmissionInput,
): Promise<Submission> {
  const parsed = submissionInputSchema.parse(input);
  const supabase = createServiceRoleClient();

  const { data: existing, error: readError } = await supabase
    .from('submissions')
    .select('id, turn_id, user_id, story_id')
    .eq('id', submissionId)
    .maybeSingle();

  if (readError !== null) {
    throw new Error(`Failed to read submission: ${readError.message}`);
  }

  if (existing === null || existing.user_id !== userId) {
    // Same error either way: a caller who is not the author should not learn
    // whether the submission exists.
    throw new Error(`Submission ${submissionId} not found.`);
  }

  const turn = await loadTurn(existing.turn_id);

  if (!acceptsSubmissions(turn.status)) {
    throw new TurnStateError(turn.id, turn.status, 'submissions are frozen once locked.');
  }

  await assertCanSubmitForEntity(turn.storyId, userId, parsed.entityId);

  const { data, error } = await supabase
    .from('submissions')
    .update({
      content: parsed.content,
      entity_id: parsed.entityId,
      proposals: parsed.proposal === null || parsed.proposal === undefined ? null : toJson({ text: parsed.proposal }),
    })
    .eq('id', submissionId)
    .select('id, turn_id, user_id, entity_id, content, proposals')
    .single();

  if (error !== null) {
    throw new Error(`Failed to update submission: ${error.message}`);
  }

  return toSubmission(data);
}

/** All submissions for a turn, in submission order. */
export async function listSubmissionsForTurn(
  turnId: string,
  userId: string,
): Promise<Submission[]> {
  const turn = await loadTurn(turnId);
  await assertMember(turn.storyId, userId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('submissions')
    .select('id, turn_id, user_id, entity_id, content, proposals')
    .eq('turn_id', turnId)
    .order('submitted_at');

  if (error !== null) {
    throw new Error(`Failed to list submissions: ${error.message}`);
  }

  return data.map(toSubmission);
}

/* ------------------------------------------------------------------ *
 * 7.4  Lock
 * ------------------------------------------------------------------ */

/**
 * Lock a turn, freezing submissions. Rejected when there are none.
 *
 * `source: 'manual'` (the default) requires the caller to hold owner/gm — a
 * player cannot lock a turn out from under other players. `source: 'deadline'`
 * is used only by the deadline sweep (deadlines.ts), which is not acting on
 * behalf of any one user and so is exempt from the role check by design.
 */
export async function lockTurn(
  turnId: string,
  userId: string,
  options: { source?: 'manual' | 'deadline' } = {},
): Promise<Turn> {
  const source = options.source ?? 'manual';
  const turn = await loadTurn(turnId);

  if (source === 'manual') {
    await requireRole(turn.storyId, userId, ['owner', 'gm']);
  } else {
    await assertMember(turn.storyId, userId);
  }

  assertTransition(turn.status, 'locked');

  const supabase = createServiceRoleClient();
  const { count, error: countError } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('turn_id', turnId);

  if (countError !== null) {
    throw new Error(`Failed to count submissions: ${countError.message}`);
  }

  if (count === null || count === 0) {
    throw new TurnStateError(
      turnId,
      turn.status,
      'cannot lock with no submissions — there is no player intent to address.',
    );
  }

  const { data, error } = await supabase
    .from('turns')
    .update({ status: 'locked' })
    .eq('id', turnId)
    .eq('status', 'open') // Optimistic guard against a concurrent lock.
    .select(TURN_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to lock turn: ${error.message}`);
  }

  if (data === null) {
    throw new TurnStateError(turnId, turn.status, 'the turn changed state concurrently.');
  }

  const moderation = await moderateLockedTurn(turnId, turn.storyId);

  if (moderation.verdict === 'block') {
    const { data: reopened, error: reopenError } = await supabase
      .from('turns')
      .update({ status: 'open', moderation_status: 'block', moderation_reason: moderation.reason })
      .eq('id', turnId)
      .select(TURN_COLUMNS)
      .maybeSingle();

    if (reopenError !== null || reopened === null) {
      throw new Error(`Failed to reopen blocked turn: ${reopenError?.message ?? 'no row returned'}`);
    }

    throw new TurnBlockedByModerationError(turnId, moderation.reason);
  }

  const { data: withModeration } = await supabase
    .from('turns')
    .update({ moderation_status: moderation.verdict, moderation_reason: moderation.reason })
    .eq('id', turnId)
    .select(TURN_COLUMNS)
    .maybeSingle();

  return toTurn(withModeration ?? data);
}

/**
 * Fail-open: a moderator call that errors after its internal retry is
 * treated as 'flag' rather than blocking the lock — see moderate.ts.
 */
async function moderateLockedTurn(turnId: string, storyId: string) {
  const supabase = createServiceRoleClient();
  const { data: story, error } = await supabase
    .from('stories')
    .select('content_rating, model_config')
    .eq('id', storyId)
    .single();

  if (error !== null) {
    throw new Error(`Failed to read story for moderation: ${error.message}`);
  }

  return moderateTurnSubmissions(
    turnId,
    story.content_rating,
    story.model_config as ModelConfig | null,
    storyId,
  );
}

/* ------------------------------------------------------------------ *
 * 7.6 - 7.8  Generation, failure, retry
 * ------------------------------------------------------------------ */

export interface GenerateResult {
  chapterId: string;
  prose: string;
  turnNumber: number;
}

interface StoryContextRow {
  title: string;
  world_ledger: unknown;
  model_config: unknown;
  turn_config: unknown;
  universe_id: string | null;
  universe_version: number | null;
  content_rating: string;
  conflict_policy: string;
}

/**
 * Generate, validate, and publish a chapter for a locked (or failed, on
 * retry) turn.
 *
 * A block-severity validation flag (validator-loop capability) regenerates
 * automatically within this same call, up to 2 retries, with the violation
 * appended to the next attempt's prompt — the caller sees this as a second
 * round of streamed chunks, not a new request. On any failure — generation
 * error, validator/gatekeeper call failure, or block-retry exhaustion — the
 * turn moves to `failed` with whatever prose was last streamed retained in
 * `partial_prose`. Submissions are never touched, so a retry reuses them
 * verbatim.
 */
export async function generateTurn(
  turnId: string,
  userId: string,
  onChunk?: (accumulated: string) => void,
): Promise<GenerateResult> {
  const turn = await loadTurn(turnId);
  await assertMember(turn.storyId, userId);

  // Covers both the first attempt (locked) and a retry (failed). An invalid
  // source state throws here rather than part-way through generation.
  assertTransition(turn.status, 'generating');

  const supabase = createServiceRoleClient();

  const { data: claimed, error: claimError } = await supabase
    .from('turns')
    .update({ status: 'generating', attempt_count: turn.attemptCount + 1 })
    .eq('id', turnId)
    .eq('status', turn.status) // Only one caller wins the claim.
    .select(TURN_COLUMNS)
    .maybeSingle();

  if (claimError !== null) {
    throw new Error(`Failed to start generation: ${claimError.message}`);
  }

  if (claimed === null) {
    throw new TurnStateError(turnId, turn.status, 'another generation is already running.');
  }

  let streamed = '';
  let attemptCount = toTurn(claimed).attemptCount;
  let promptAddendum: string | null = null;

  try {
    const context = await buildTurnContext(turn);
    const mode = resolveTurnMode(turn.mode);
    const canonExceptions = await loadCanonExceptions(turn.storyId);

    // Runs once, before the first Narrator attempt — not re-run on a
    // block-severity retry, since the proposal itself hasn't changed between
    // attempts (design.md Decision 4: the ruling must be in the Narrator's
    // hands before it writes, for either attempt).
    const gatekeeperRulings = await evaluateTurnProposals(turn.storyId, context, canonExceptions, userId);

    // fight-chapter-split: computed once, from submission structure alone —
    // never re-evaluated per retry attempt, and enforced again below
    // regardless of what the model actually emits.
    const turningPointEligible = isTurningPointEligible(context.submissionEntityIds, turn.continuesChapterId);

    let turningPoint = false;

    // Resolved once for the whole turn: the GM's OpenRouter key (else the
    // owner's, else the platform key) bills every attempt in this loop.
    const { key: openRouterKey } = await resolveStoryApiKey(turn.storyId);

    for (;;) {
      const result = await streamNarration(
        {
          apiKey: openRouterKey,
          usage: createUsageRecorder(turn.storyId, userId),
          budget: createBudgetGuard(turn.storyId, userId),
        },
        {
          modelConfig: context.modelConfig,
          systemPrompt: mode.systemPrompt({
            contentRating: context.contentRating,
            conflictPolicy: context.conflictPolicy,
            pacing: context.pacing,
            gatekeeperRulings,
            turningPointEligible,
          }),
          userPrompt: promptAddendum === null ? context.prompt : `${context.prompt}\n\n${promptAddendum}`,
          onChunk: (accumulated) => {
            streamed = accumulated;
            onChunk?.(accumulated);
          },
        },
      );

      streamed = result.prose;

      if (!result.completed || result.prose.trim().length === 0) {
        throw new Error(
          result.prose.trim().length === 0
            ? 'The narrator returned no prose.'
            : 'The narration stream ended before completing.',
        );
      }

      // Strip the marker before it ever reaches validation, persistence, or
      // a reader — regardless of eligibility, so an ineligible turn's
      // accidental marker never leaks into a published chapter.
      const extracted = extractTurningPoint(result.prose, turningPointEligible);
      result.prose = extracted.prose;
      turningPoint = extracted.turningPoint;

      // generating -> validating: the draft is complete, but not yet publishable.
      const { error: validatingError } = await supabase
        .from('turns')
        .update({ status: 'validating' })
        .eq('id', turnId)
        .eq('status', 'generating');

      if (validatingError !== null) {
        throw new Error(`Failed to enter validation: ${validatingError.message}`);
      }

      const outcome = await runValidation({
        storyId: turn.storyId,
        chapterDraft: result.prose,
        attemptCount,
        progressionModel: context.progressionModel,
        researchRules: context.validationRules,
        entities: context.entities,
        canonExceptions,
        modelConfig: context.modelConfig,
        userId,
      });

      if (outcome.action === 'publish') {
        const { data: published, error: publishError } = await supabase.rpc('publish_chapter', {
          p_turn_id: turnId,
          p_prose: result.prose,
          p_entity_ids: context.entityIds,
          p_validation_report: toValidationReportJson(outcome.flags),
        });

        if (publishError !== null || published === null) {
          throw new Error(publishError?.message ?? 'publish returned no row');
        }

        const chapter = published as unknown as { id: string; turn_number: number };

        // fight-chapter-split: chapter 1 is already committed and published
        // above by this point — a continuation failure must never alter,
        // unpublish, or delay it, so it is caught and logged here rather
        // than propagated, same isolation pattern as
        // queueChapterIllustration's catch in image-prompts.ts.
        if (turningPoint) {
          try {
            await continueFight(chapter.id, turn.storyId);
          } catch (continuationCause) {
            console.error('fight continuation failed', {
              chapterId: chapter.id,
              storyId: turn.storyId,
              message: continuationCause instanceof Error ? continuationCause.message : String(continuationCause),
            });
          }
        }

        return {
          chapterId: chapter.id,
          prose: result.prose,
          turnNumber: chapter.turn_number,
        };
      }

      if (outcome.action === 'fail') {
        throw new Error(
          `Validation blocked publication after retries: ${outcome.blockingRuleIds.join(', ')}`,
        );
      }

      // outcome.action === 'retry': validating -> generating, try again with
      // the violation appended to the prompt. Reuses the failed -> generating
      // transition shape (this is a retry within the same call, not a new
      // one), with attempt_count already incremented for the draft that just
      // got blocked.
      promptAddendum = buildBlockRetryAddendum(outcome.flags);

      const { data: retried, error: retryError } = await supabase
        .from('turns')
        .update({ status: 'generating', attempt_count: attemptCount + 1 })
        .eq('id', turnId)
        .eq('status', 'validating')
        .select(TURN_COLUMNS)
        .maybeSingle();

      if (retryError !== null || retried === null) {
        throw new Error(retryError?.message ?? 'Failed to restart generation after a block-severity flag.');
      }

      attemptCount = toTurn(retried).attemptCount;
    }
  } catch (cause) {
    await markTurnFailed(turnId, streamed, cause);
    throw cause;
  }
}

/**
 * fight-chapter-split: create and drive the automatic continuation turn that
 * resolves a fight after chapter `chapterId` published with the
 * turning-point marker.
 *
 * `continue_fight_turn` (RPC) atomically creates the new turn already
 * `locked` — same one-live-turn advisory lock as `open_turn` — with
 * submissions copied forward from the originating turn's turn_id. From
 * there this is exactly `generateTurn`'s own path: no acting user (there is
 * none), no moderation re-check (the content isn't new — see the RPC
 * comment), and `turn.continuesChapterId` being set means `generateTurn`'s
 * own eligibility check (`isTurningPointEligible`) forces this generation to
 * resolve the fight rather than split again.
 *
 * Callers must not let a failure here propagate into the original
 * `generateTurn` call's result — see the isolated catch at the call site.
 */
async function continueFight(chapterId: string, storyId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: created, error } = await supabase.rpc('continue_fight_turn', {
    p_chapter_id: chapterId,
    p_story_id: storyId,
  });

  if (error !== null || created === null) {
    throw new Error(error?.message ?? 'continue_fight_turn returned no row');
  }

  const turn = toTurn(created as unknown as TurnRow);

  // No acting user drives this call, and generateTurn's own assertMember
  // check would fail without one — pass the story's owner. loadTurn/
  // assertMember only gate on membership, which the owner always has; this
  // mirrors the system-initiated nature of this whole path (design.md
  // Decision 3), not a privilege escalation, since no player-facing action
  // is being taken on anyone's behalf.
  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('owner_id')
    .eq('id', storyId)
    .single();

  if (storyError !== null || story === null || story.owner_id === null) {
    throw new Error(storyError?.message ?? `Story ${storyId} has no owner to attribute this continuation to.`);
  }

  await generateTurn(turn.id, story.owner_id);
}

/**
 * Move a turn to `failed`, retaining partial prose. Submissions are untouched
 * by design — that is what makes the turn retryable.
 */
async function markTurnFailed(
  turnId: string,
  partialProse: string,
  cause: unknown,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const reason = cause instanceof Error ? cause.message : String(cause);

  const { error } = await supabase
    .from('turns')
    .update({
      status: 'failed',
      failure_reason: reason.slice(0, 2000),
      partial_prose: partialProse.length > 0 ? partialProse : null,
    })
    .eq('id', turnId);

  if (error !== null) {
    // Surfaced but not thrown: the original failure is the one worth
    // propagating to the caller.
    console.error('Failed to mark turn as failed', { turnId, message: error.message });
  }
}

/**
 * Retry a failed turn. Reuses the original submissions verbatim — nothing is
 * re-entered, and no submission is rewritten.
 */
export async function retryTurn(
  turnId: string,
  userId: string,
  onChunk?: (accumulated: string) => void,
): Promise<GenerateResult> {
  const turn = await loadTurn(turnId);

  if (turn.status !== 'failed') {
    throw new TurnStateError(turnId, turn.status, 'only a failed turn can be retried.');
  }

  return generateTurn(turnId, userId, onChunk);
}

/* ------------------------------------------------------------------ *
 * Context assembly inputs
 * ------------------------------------------------------------------ */

interface TurnContext {
  prompt: string;
  entityIds: string[];
  entities: ContextEntity[];
  modelConfig: ModelConfig | null;
  contentRating: string;
  conflictPolicy: string;
  pacing: string;
  progressionModel: string;
  validationRules: Rule[];
  proposalSubmissions: { entityId: string | null; proposal: string }[];
  /** entity_id of every submission on this turn, for the fight-chapter-split
   * eligibility check (at most one distinct submitting entity — the fight's
   * opponent need not have submitted anything). */
  submissionEntityIds: (string | null)[];
}

/**
 * Evaluate every proposal submitted this turn through the Gatekeeper
 * (gatekeeper capability) and return the rulings as prose lines for the
 * Narrator prompt. A proposal whose Gatekeeper call fails after its own
 * retry propagates — a proposal that could not be ruled on must not reach
 * the Narrator un-adjudicated (gatekeeper spec, "Retry exhaustion raises
 * typed error and turn fails").
 */
async function evaluateTurnProposals(
  storyId: string,
  context: TurnContext,
  canonExceptions: CanonException[],
  userId: string,
): Promise<string[]> {
  if (context.proposalSubmissions.length === 0) {
    return [];
  }

  const universeRulesText = JSON.stringify(context.validationRules);
  const entityById = new Map(context.entities.map((entity) => [entity.id, entity]));

  const rulings: string[] = [];

  for (const submission of context.proposalSubmissions) {
    const entity = submission.entityId === null ? null : (entityById.get(submission.entityId) ?? null);

    const { verdict } = await evaluateProposal({
      storyId,
      entityId: submission.entityId,
      proposal: submission.proposal,
      progressionModel: context.progressionModel,
      universeRulesText,
      entity,
      canonExceptions,
      modelConfig: context.modelConfig,
      usage: createUsageRecorder(storyId, userId),
      budget: createBudgetGuard(storyId, userId),
    });

    const entityLabel = entity?.name ?? '(unclaimed entity)';
    const limits = verdict.imposed_limits !== undefined && verdict.imposed_limits.length > 0
      ? ` Limits: ${verdict.imposed_limits.join('; ')}.`
      : '';

    rulings.push(
      `- ${entityLabel} proposed: "${submission.proposal}" — verdict: ${verdict.verdict}. ${verdict.reasoning}${limits}`,
    );
  }

  return rulings;
}

/**
 * Gather the persisted inputs and run the pure `assembleContext`. All reads,
 * no writes — assembly itself stays pure.
 */
async function buildTurnContext(turn: Turn): Promise<TurnContext> {
  const supabase = createServiceRoleClient();

  const [storyResult, entityResult, chapterResult, submissionResult] = await Promise.all([
    supabase
      .from('stories')
      .select(
        'title, world_ledger, model_config, turn_config, universe_id, universe_version, content_rating, conflict_policy',
      )
      .eq('id', turn.storyId)
      .single(),
    supabase
      .from('entities')
      .select('id, type, name, status, data')
      .eq('story_id', turn.storyId),
    supabase
      .from('chapters')
      .select('turn_number, prose')
      .eq('story_id', turn.storyId)
      .order('turn_number', { ascending: false })
      .limit(5),
    supabase
      .from('submissions')
      .select('content, entity_id, proposals')
      .eq('turn_id', turn.id)
      .order('submitted_at'),
  ]);

  if (storyResult.error !== null) {
    throw new Error(`Failed to read story: ${storyResult.error.message}`);
  }

  if (entityResult.error !== null) {
    throw new Error(`Failed to read entities: ${entityResult.error.message}`);
  }

  if (chapterResult.error !== null) {
    throw new Error(`Failed to read chapters: ${chapterResult.error.message}`);
  }

  if (submissionResult.error !== null) {
    throw new Error(`Failed to read submissions: ${submissionResult.error.message}`);
  }

  const story = storyResult.data as StoryContextRow;

  const entities: ContextEntity[] = entityResult.data.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    data: (row.data ?? {}) as Record<string, unknown>,
  }));

  const entityNames = new Map(entities.map((entity) => [entity.id, entity.name]));

  // Query returned newest-first for the limit; assembly wants oldest-first.
  const recentChapters: ContextChapter[] = chapterResult.data
    .map((row) => ({ turnNumber: row.turn_number, prose: row.prose }))
    .reverse();

  const submissions = submissionResult.data.map((row) => ({
    entityName: row.entity_id === null ? null : (entityNames.get(row.entity_id) ?? null),
    content: row.content,
  }));

  const proposalSubmissions: { entityId: string | null; proposal: string }[] = submissionResult.data
    .map((row) => {
      const proposals = row.proposals as { text?: unknown } | null;
      return typeof proposals?.text === 'string'
        ? { entityId: row.entity_id, proposal: proposals.text }
        : null;
    })
    .filter((value): value is { entityId: string | null; proposal: string } => value !== null);

  const toneDirectives = readToneDirectives(story.turn_config);
  const modelConfig = (story.model_config ?? null) as ModelConfig | null;

  const { contextPolicy, canonBibleText, progressionModel, validationRules } = await resolveUniverseContext(
    story.universe_id,
    story.universe_version,
  );

  const queryText = submissions.map((submission) => submission.content).join('\n');
  const retrievedSummaries =
    queryText.length > 0 && (contextPolicy.retrievedChapters ?? 0) > 0
      ? await retrieveRelevantSummaries({
          storyId: turn.storyId,
          queryText,
          k: contextPolicy.retrievedChapters ?? 0,
          modelConfig,
          usage: createUsageRecorder(turn.storyId, null),
          budget: createBudgetGuard(turn.storyId, null),
        })
      : [];

  const assembled = assembleContext({
    story: {
      title: story.title,
      toneDirectives,
      worldLedger: (story.world_ledger ?? {}) as Record<string, unknown>,
      canonBibleText,
    },
    turn: {
      turnNumber: turn.turnNumber,
      mode: turn.mode,
      sceneSetup: turn.sceneSetup,
    },
    entities,
    recentChapters,
    retrievedSummaries,
    submissions,
    policy: contextPolicy,
    // Fresh per assembly, so the fences around this turn's player content
    // cannot be predicted by whoever wrote that content.
    fenceNonce: newFenceNonce(),
  });

  return {
    prompt: assembled.prompt,
    entityIds: entities.filter((entity) => entity.status === 'active').map((entity) => entity.id),
    entities,
    modelConfig,
    contentRating: story.content_rating,
    conflictPolicy: story.conflict_policy,
    pacing: readPacing(story.turn_config),
    progressionModel,
    validationRules,
    proposalSubmissions,
    submissionEntityIds: submissionResult.data.map((row) => row.entity_id),
  };
}

/** turn_config is opaque jsonb; read one optional key without asserting a shape. */
function readToneDirectives(turnConfig: unknown): string | null {
  if (turnConfig === null || typeof turnConfig !== 'object') {
    return null;
  }

  const value = (turnConfig as Record<string, unknown>).tone_directives;

  return typeof value === 'string' && value.length > 0 ? value : null;
}

interface UniverseContext {
  contextPolicy: ContextPolicy;
  canonBibleText: string | null;
  progressionModel: string;
  validationRules: Rule[];
}

/**
 * Resolve the story's pinned universe version's context policy, compressed
 * canon bible text, progression model, and validation rules. An unpinned
 * story (no universe, or one created before Phase 2) gets the documented
 * default policy, no canon bible, the `none` progression model, and no
 * research-derived rules (the Standard Rule Pack still applies — see
 * rule-engine.ts) — exactly Phase 1 behavior, per context-assembly spec's
 * "Story without a pinned universe version uses default policy."
 */
async function resolveUniverseContext(
  universeId: string | null | undefined,
  universeVersion: number | null | undefined,
): Promise<UniverseContext> {
  if (universeId === null || universeId === undefined || universeVersion === null || universeVersion === undefined) {
    return {
      contextPolicy: ENGINE_DEFAULT_CONTEXT_POLICY,
      canonBibleText: null,
      progressionModel: DEFAULT_PROGRESSION_MODEL,
      validationRules: [],
    };
  }

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('universe_versions')
    .select('context_policy, canon_bible_summary, canon_bible_rules_only, progression_model, validation_rules')
    .eq('universe_id', universeId)
    .eq('version', universeVersion)
    .maybeSingle();

  if (data === null) {
    return {
      contextPolicy: ENGINE_DEFAULT_CONTEXT_POLICY,
      canonBibleText: null,
      progressionModel: DEFAULT_PROGRESSION_MODEL,
      validationRules: [],
    };
  }

  const stored = data.context_policy as StoredContextPolicy | null;
  const contextPolicy: ContextPolicy = {
    recentChapters: stored?.recent_chapters ?? ENGINE_DEFAULT_CONTEXT_POLICY.recentChapters,
    tokenBudget: stored?.token_budget ?? ENGINE_DEFAULT_CONTEXT_POLICY.tokenBudget,
    retrievedChapters: stored?.retrieved_chapters ?? 5,
    retrievalBias: stored?.retrieval_bias ?? 'precedent',
    canonCompression: stored?.canon_compression ?? 'full',
  };

  const canonBibleText = resolveCanonBibleText(
    contextPolicy.canonCompression,
    data.canon_bible_summary,
    data.canon_bible_rules_only,
  );

  const validationRules = parseValidationRules(data.validation_rules);

  return { contextPolicy, canonBibleText, progressionModel: data.progression_model, validationRules };
}

/** universe_versions.validation_rules is opaque jsonb, written only through
 * universes.ts's universeVersionInputSchema — parse defensively rather than
 * casting, so a malformed row degrades to "no research rules" instead of
 * throwing mid-generation. */
function parseValidationRules(value: unknown): Rule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed = z.array(ruleSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** No `full` variant is stored separately — `canon_compression: 'full'` means
 * "no compression," which this module has no full canon bible to render from
 * yet (see universes.ts's UniverseVersionInput.canonBible doc comment), so it
 * resolves to null exactly like an unpinned story. */
function resolveCanonBibleText(
  canonCompression: string | undefined,
  summary: unknown,
  rulesOnly: unknown,
): string | null {
  if (canonCompression === 'summary' && summary !== null && summary !== undefined) {
    return JSON.stringify(summary, null, 2);
  }

  if (canonCompression === 'rules_only' && rulesOnly !== null && rulesOnly !== undefined) {
    return JSON.stringify(rulesOnly, null, 2);
  }

  return null;
}
