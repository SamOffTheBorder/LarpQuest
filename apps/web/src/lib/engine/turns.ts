import 'server-only';

import { z } from 'zod';

import { streamNarration } from '@/lib/ai/gateway';
import type { ModelConfig } from '@/lib/ai/roles';
import { createUsageRecorder } from '@/lib/ai/usage';
import { assembleContext, type ContextChapter, type ContextEntity } from '@/lib/engine/context';
import { assertMember } from '@/lib/engine/membership';
import { DEFAULT_TURN_MODE, resolveTurnMode } from '@/lib/engine/turn-modes';
import { acceptsSubmissions, assertTransition, type TurnStatus } from '@/lib/engine/turn-state';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';

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
  };
}

const TURN_COLUMNS =
  'id, story_id, turn_number, mode, scene_setup, status, partial_prose, failure_reason, attempt_count';

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
  await assertMember(storyId, userId);

  const mode = options.mode ?? DEFAULT_TURN_MODE;
  resolveTurnMode(mode); // Reject an unregistered mode before writing.

  const sceneSetup = options.sceneSetup ?? null;

  const supabase = createServiceRoleClient();
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
});

export type SubmissionInput = z.infer<typeof submissionInputSchema>;

export interface Submission {
  id: string;
  turnId: string;
  userId: string;
  entityId: string | null;
  content: string;
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

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('submissions')
    .insert({
      turn_id: turnId,
      story_id: turn.storyId,
      user_id: userId,
      entity_id: parsed.entityId,
      content: parsed.content,
    })
    .select('id, turn_id, user_id, entity_id, content')
    .single();

  if (error !== null) {
    throw new Error(`Failed to create submission: ${error.message}`);
  }

  return {
    id: data.id,
    turnId: data.turn_id,
    userId: data.user_id,
    entityId: data.entity_id,
    content: data.content,
  };
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

  const { data, error } = await supabase
    .from('submissions')
    .update({ content: parsed.content, entity_id: parsed.entityId })
    .eq('id', submissionId)
    .select('id, turn_id, user_id, entity_id, content')
    .single();

  if (error !== null) {
    throw new Error(`Failed to update submission: ${error.message}`);
  }

  return {
    id: data.id,
    turnId: data.turn_id,
    userId: data.user_id,
    entityId: data.entity_id,
    content: data.content,
  };
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
    .select('id, turn_id, user_id, entity_id, content')
    .eq('turn_id', turnId)
    .order('submitted_at');

  if (error !== null) {
    throw new Error(`Failed to list submissions: ${error.message}`);
  }

  return data.map((row) => ({
    id: row.id,
    turnId: row.turn_id,
    userId: row.user_id,
    entityId: row.entity_id,
    content: row.content,
  }));
}

/* ------------------------------------------------------------------ *
 * 7.4  Lock
 * ------------------------------------------------------------------ */

/** Lock a turn, freezing submissions. Rejected when there are none. */
export async function lockTurn(turnId: string, userId: string): Promise<Turn> {
  const turn = await loadTurn(turnId);
  await assertMember(turn.storyId, userId);

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

  return toTurn(data);
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
}

/**
 * Generate and publish a chapter for a locked (or failed, on retry) turn.
 *
 * On any failure the turn moves to `failed` with whatever prose was streamed
 * retained in `partial_prose`. Submissions are never touched, so a retry
 * reuses them verbatim.
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

  try {
    const context = await buildTurnContext(turn);
    const mode = resolveTurnMode(turn.mode);

    const result = await streamNarration(
      {
        apiKey: serverEnv().OPENROUTER_API_KEY,
        usage: createUsageRecorder(turn.storyId, userId),
      },
      {
        modelConfig: context.modelConfig,
        systemPrompt: mode.systemPrompt,
        userPrompt: context.prompt,
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

    const { data: published, error: publishError } = await supabase.rpc('publish_chapter', {
      p_turn_id: turnId,
      p_prose: result.prose,
      p_entity_ids: context.entityIds,
    });

    if (publishError !== null || published === null) {
      throw new Error(publishError?.message ?? 'publish returned no row');
    }

    const chapter = published as unknown as { id: string; turn_number: number };

    return {
      chapterId: chapter.id,
      prose: result.prose,
      turnNumber: chapter.turn_number,
    };
  } catch (cause) {
    await markTurnFailed(turnId, streamed, cause);
    throw cause;
  }
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
  modelConfig: ModelConfig | null;
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
      .select('title, world_ledger, model_config, turn_config')
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
      .select('content, entity_id')
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

  const toneDirectives = readToneDirectives(story.turn_config);

  const assembled = assembleContext({
    story: {
      title: story.title,
      toneDirectives,
      worldLedger: (story.world_ledger ?? {}) as Record<string, unknown>,
    },
    turn: {
      turnNumber: turn.turnNumber,
      mode: turn.mode,
      sceneSetup: turn.sceneSetup,
    },
    entities,
    recentChapters,
    submissions,
  });

  return {
    prompt: assembled.prompt,
    entityIds: entities.filter((entity) => entity.status === 'active').map((entity) => entity.id),
    modelConfig: (story.model_config ?? null) as ModelConfig | null,
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
