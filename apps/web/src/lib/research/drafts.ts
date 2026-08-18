import 'server-only';

import { inngest } from '@/inngest/client';
import { draftDocumentSchema, type DraftDocument } from '@/lib/research/draft';
import { draftInputSchema, RESEARCH_STAGES, type DraftInput, type ResearchStage } from '@/lib/research/schemas';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * Draft persistence and lifecycle.
 *
 * A draft is owned by one user, not gated through story_members — see
 * migration 20260818000001's comment and design.md decision 1. Every read
 * here checks `owner_id` explicitly (rather than relying solely on RLS)
 * because the service-role client bypasses RLS, same discipline
 * `stories.ts`/`universes.ts` already follow.
 */

export class DraftNotFoundError extends Error {
  constructor(readonly draftId: string) {
    // A non-owner and a nonexistent draft look identical to the caller.
    super(`Draft ${draftId} not found.`);
    this.name = 'DraftNotFoundError';
  }
}

export interface UniverseDraft {
  id: string;
  ownerId: string;
  status: 'researching' | 'ready_for_review' | 'published';
  input: DraftInput;
  draft: DraftDocument;
  universeId: string | null;
  publishedVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

interface UniverseDraftRow {
  id: string;
  owner_id: string;
  status: string;
  input: unknown;
  draft: unknown;
  universe_id: string | null;
  published_version: number | null;
  created_at: string;
  updated_at: string;
}

function toUniverseDraft(row: UniverseDraftRow): UniverseDraft {
  return {
    id: row.id,
    ownerId: row.owner_id,
    status: row.status as UniverseDraft['status'],
    input: row.input as DraftInput,
    // Written only through this module; draft.ts's applyStageOutput is the
    // only writer of section content, so this reflects a real invariant.
    draft: draftDocumentSchema.parse(row.draft ?? {}),
    universeId: row.universe_id,
    publishedVersion: row.published_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ResearchJobStatus {
  stage: ResearchStage;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'skipped';
  attemptCount: number;
  output: unknown;
  previousOutput: unknown;
  lastError: string | null;
  updatedAt: string;
}

interface ResearchJobRow {
  stage: string;
  status: string;
  attempt_count: number;
  output: unknown;
  previous_output: unknown;
  last_error: string | null;
  updated_at: string;
}

function toResearchJobStatus(row: ResearchJobRow): ResearchJobStatus {
  return {
    stage: row.stage as ResearchStage,
    status: row.status as ResearchJobStatus['status'],
    attemptCount: row.attempt_count,
    output: row.output,
    previousOutput: row.previous_output,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

/**
 * Create a draft, seed its eight per-stage job rows, and trigger the
 * pipeline. Returns immediately — the pipeline runs out of band in Inngest
 * (research-pipeline spec, "Durable, resumable pipeline execution").
 */
export async function createDraft(ownerId: string, input: DraftInput): Promise<UniverseDraft> {
  const parsed = draftInputSchema.parse(input);
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('universe_drafts')
    .insert({ owner_id: ownerId, input: toJson(parsed), status: 'researching' })
    .select('id, owner_id, status, input, draft, universe_id, published_version, created_at, updated_at')
    .single();

  if (error !== null || data === null) {
    throw new Error(`Failed to create draft: ${error?.message ?? 'no row returned'}`);
  }

  const { error: jobsError } = await supabase.from('research_jobs').insert(
    RESEARCH_STAGES.map((stage) => ({ draft_id: data.id, stage, status: 'queued' as const })),
  );

  if (jobsError !== null) {
    throw new Error(`Failed to seed research jobs: ${jobsError.message}`);
  }

  await inngest.send({ name: 'research/draft.requested', data: { draftId: data.id } });

  return toUniverseDraft(data);
}

export async function getDraft(draftId: string, ownerId: string): Promise<UniverseDraft> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('universe_drafts')
    .select('id, owner_id, status, input, draft, universe_id, published_version, created_at, updated_at')
    .eq('id', draftId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read draft: ${error.message}`);
  }

  if (data === null || data.owner_id !== ownerId) {
    throw new DraftNotFoundError(draftId);
  }

  return toUniverseDraft(data);
}

export async function listDraftJobs(draftId: string, ownerId: string): Promise<ResearchJobStatus[]> {
  // Ownership-check first, same as every other read here — a non-owner must
  // see "not found," never a listing of someone else's job rows.
  await getDraft(draftId, ownerId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('research_jobs')
    .select('stage, status, attempt_count, output, previous_output, last_error, updated_at')
    .eq('draft_id', draftId)
    .order('created_at', { ascending: true });

  if (error !== null) {
    throw new Error(`Failed to list research jobs: ${error.message}`);
  }

  return (data ?? []).map(toResearchJobStatus);
}

/**
 * Re-run a single stage. The stage's current output moves to
 * `previous_output` (kept one generation back, per design.md decision 7) and
 * its status resets to `queued`; the pipeline is re-triggered scoped to just
 * this stage via a distinct event so the Inngest function can re-enter at the
 * right point rather than restarting from Stage 1.
 */
export async function rerunStage(draftId: string, ownerId: string, stage: ResearchStage): Promise<void> {
  await getDraft(draftId, ownerId);

  const supabase = createServiceRoleClient();

  const { data: current, error: readError } = await supabase
    .from('research_jobs')
    .select('output')
    .eq('draft_id', draftId)
    .eq('stage', stage)
    .maybeSingle();

  if (readError !== null) {
    throw new Error(`Failed to read research job: ${readError.message}`);
  }

  const { error: updateError } = await supabase
    .from('research_jobs')
    .update({
      status: 'queued',
      previous_output: current?.output ?? null,
      output: null,
      last_error: null,
    })
    .eq('draft_id', draftId)
    .eq('stage', stage);

  if (updateError !== null) {
    throw new Error(`Failed to reset research job: ${updateError.message}`);
  }

  await inngest.send({ name: 'research/stage.rerun.requested', data: { draftId, stage } });
}
