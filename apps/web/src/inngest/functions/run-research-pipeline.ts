import 'server-only';

import type { GetStepTools } from 'inngest';

import { inngest } from '@/inngest/client';
import type { BudgetGuard, UsageRecorder } from '@/lib/ai/gateway';
import { createBudgetGuard } from '@/lib/ai/spend';
import { createUsageRecorder } from '@/lib/ai/usage';
import { applyStageOutput, type DraftDocument } from '@/lib/research/draft';
import { buildGapsReport } from '@/lib/research/gaps';
import { runStage, shouldRunProgressionStage } from '@/lib/research/pipeline';
import { buildStageRequest } from '@/lib/research/stage-request';
import {
  scopingResultSchema,
  type DraftInput,
  type ResearchStage,
} from '@/lib/research/schemas';
import type { Database } from '@/lib/supabase/database.types';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * The 8-stage research pipeline orchestrator (build plan Part 2.2).
 *
 * One Inngest function, one `step.run` per stage (design.md decision 2):
 * stages are inherently sequential, so chaining 8 separate event-triggered
 * functions would only add failure surface without adding real concurrency.
 * `step.run` gives per-step retry and memoization for free — if this function
 * is replayed after a crash, Inngest skips re-executing (and re-billing) any
 * step that already completed.
 *
 * Each step writes its own `research_jobs` row from inside `step.run` (design
 * decision 3), so the status transition happens exactly once, at the moment
 * the stage actually executes. Per-stage prompt/schema construction lives in
 * `stage-request.ts`, shared with the single-stage re-run function in
 * `rerun-research-stage.ts` so a re-run asks the pipeline's exact original
 * question.
 */

type ResearchJobsUpdate = Database['public']['Tables']['research_jobs']['Update'];
type UniverseDraftsUpdate = Database['public']['Tables']['universe_drafts']['Update'];

export async function markJob(
  draftId: string,
  stage: ResearchStage,
  patch:
    | { status: 'running' }
    | { status: 'complete' | 'skipped'; output: unknown }
    | { status: 'failed'; last_error: string },
): Promise<void> {
  const supabase = createServiceRoleClient();

  if (patch.status === 'running') {
    await supabase.rpc('start_research_job', { p_draft_id: draftId, p_stage: stage });
    return;
  }

  const update: ResearchJobsUpdate =
    patch.status === 'failed'
      ? { status: 'failed', last_error: patch.last_error }
      : { status: patch.status, output: toJson(patch.output) };

  await supabase.from('research_jobs').update(update).eq('draft_id', draftId).eq('stage', stage);
}

export async function persistDraft(
  draftId: string,
  draft: DraftDocument,
  status?: UniverseDraftsUpdate['status'],
): Promise<void> {
  const supabase = createServiceRoleClient();
  const update: UniverseDraftsUpdate = { draft: toJson(draft) };
  if (status !== undefined) update.status = status;
  await supabase.from('universe_drafts').update(update).eq('id', draftId);
}

/** Runs one stage end to end: mark running, call the model, mark the result. Returns the outcome. */
async function executeStage(
  draftId: string,
  stage: Exclude<ResearchStage, 'gaps'>,
  input: DraftInput,
  draft: DraftDocument,
  // Bundled rather than two positional parameters: the pair travels together
  // through eight call sites, and an argument order that can be swapped is an
  // argument order that eventually is.
  spend: { usage: UsageRecorder; budget: BudgetGuard },
) {
  await markJob(draftId, stage, { status: 'running' });

  const request = buildStageRequest(stage, input, draft);
  const outcome = await runStage({
    stage,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    schema: request.schema,
    usage: spend.usage,
    budget: spend.budget,
  });

  await markJob(
    draftId,
    stage,
    outcome.status === 'complete'
      ? { status: 'complete', output: outcome.output }
      : { status: 'failed', last_error: outcome.error },
  );

  return outcome;
}

/** Trigger payload for the pipeline's start event. */
interface ResearchDraftRequestedEvent {
  name: 'research/draft.requested';
  data: { draftId: string };
}

export const runResearchPipeline = inngest.createFunction(
  { id: 'run-research-pipeline', retries: 2, triggers: [{ event: 'research/draft.requested' }] },
  async ({ event, step }: { event: ResearchDraftRequestedEvent; step: GetStepTools<typeof inngest> }) => {
    const { draftId } = event.data;
    const supabase = createServiceRoleClient();

    const { data: draftRow, error: draftError } = await supabase
      .from('universe_drafts')
      .select('input, owner_id')
      .eq('id', draftId)
      .single();

    if (draftError !== null || draftRow === null) {
      throw new Error(`Draft ${draftId} not found: ${draftError?.message ?? 'no row'}`);
    }

    const input = draftRow.input as unknown as DraftInput;
    // Research is not story-scoped — a draft has an owner but no story yet —
    // so only the per-user cap applies here.
    const spend = {
      usage: createUsageRecorder(null, draftRow.owner_id),
      budget: createBudgetGuard(null, draftRow.owner_id),
    };

    let draft: DraftDocument = { auMarks: [] };

    const scopingOutcome = await step.run('stage-scoping', () => executeStage(draftId, 'scoping', input, draft, spend));
    if (scopingOutcome.status === 'complete') {
      draft = applyStageOutput(draft, 'scoping', scopingOutcome.output);
      await persistDraft(draftId, draft);
    }

    const rulesOutcome = await step.run('stage-rules-mechanics', () => executeStage(draftId, 'rules_mechanics', input, draft, spend));
    if (rulesOutcome.status === 'complete') {
      draft = applyStageOutput(draft, 'rules_mechanics', rulesOutcome.output);
      await persistDraft(draftId, draft);
    }

    // Stage 3 — Power/Progression. Conditionally skipped per Stage 1's own
    // output (research-pipeline spec, "Conditional Power/Progression stage").
    const runProgression =
      scopingOutcome.status === 'complete' &&
      shouldRunProgressionStage(scopingResultSchema.parse(scopingOutcome.output));

    const progressionOutcome = await step.run('stage-progression', async () => {
      if (!runProgression) {
        await markJob(draftId, 'progression', { status: 'skipped', output: null });
        return { status: 'skipped' as const };
      }
      return executeStage(draftId, 'progression', input, draft, spend);
    });
    if (progressionOutcome.status === 'complete') {
      draft = applyStageOutput(draft, 'progression', progressionOutcome.output);
      await persistDraft(draftId, draft);
    }

    const entitiesOutcome = await step.run('stage-entities', () => executeStage(draftId, 'entities', input, draft, spend));
    if (entitiesOutcome.status === 'complete') {
      draft = applyStageOutput(draft, 'entities', entitiesOutcome.output);
      await persistDraft(draftId, draft);
    }

    const timelineOutcome = await step.run('stage-timeline', () => executeStage(draftId, 'timeline', input, draft, spend));
    if (timelineOutcome.status === 'complete') {
      draft = applyStageOutput(draft, 'timeline', timelineOutcome.output);
      await persistDraft(draftId, draft);
    }

    const schemaDerivationOutcome = await step.run('stage-schema-derivation', () =>
      executeStage(draftId, 'schema_derivation', input, draft, spend),
    );
    if (schemaDerivationOutcome.status === 'complete') {
      draft = applyStageOutput(draft, 'schema_derivation', schemaDerivationOutcome.output);
      await persistDraft(draftId, draft);
    }

    const rulePackOutcome = await step.run('stage-rule-pack', () => executeStage(draftId, 'rule_pack', input, draft, spend));
    if (rulePackOutcome.status === 'complete') {
      draft = applyStageOutput(draft, 'rule_pack', rulePackOutcome.output);
      await persistDraft(draftId, draft);
    }

    // Stage 8 — Confidence & Gaps Report. Not a model call: aggregates
    // everything above, including any failed/skipped stage.
    await step.run('stage-gaps', async () => {
      await markJob(draftId, 'gaps', { status: 'running' });

      const { data: jobRows } = await supabase
        .from('research_jobs')
        .select('stage, status, last_error')
        .eq('draft_id', draftId);

      const jobs = (jobRows ?? []).map((row) => ({
        stage: row.stage,
        status: row.status as 'queued' | 'running' | 'complete' | 'failed' | 'skipped',
        lastError: row.last_error ?? undefined,
      }));

      const gaps = buildGapsReport(draft, jobs);
      draft = applyStageOutput(draft, 'gaps', gaps);
      await persistDraft(draftId, draft, 'ready_for_review');
      await markJob(draftId, 'gaps', { status: 'complete', output: gaps });
    });

    return { draftId, status: 'ready_for_review' };
  },
);
