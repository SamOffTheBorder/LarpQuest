import 'server-only';

import type { GetStepTools } from 'inngest';

import { inngest } from '@/inngest/client';
import { markJob, persistDraft } from '@/inngest/functions/run-research-pipeline';
import { createUsageRecorder } from '@/lib/ai/usage';
import { applyStageOutput, draftDocumentSchema, type DraftDocument } from '@/lib/research/draft';
import { runStage } from '@/lib/research/pipeline';
import { buildStageRequest } from '@/lib/research/stage-request';
import type { DraftInput, ResearchStage } from '@/lib/research/schemas';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Re-runs exactly one stage (universe-review spec, "Re-run with diff view").
 *
 * `drafts.ts`'s `rerunStage` already moved the stage's current output to
 * `previous_output` and reset it to `queued` before sending this event — this
 * function's only job is to execute the stage again, using the *persisted*
 * draft document for upstream context (via `buildStageRequest`, the same
 * dispatcher the full pipeline uses) so the re-run asks the identical
 * question the original run asked, edits included (stage-request.ts prefers
 * `editedContent` over `content` for an edited section).
 *
 * Stage 8 (gaps) is never targeted by this function — it has no re-run
 * affordance in the review UI since it is derived, not researched.
 */
interface RerunRequestedEvent {
  name: 'research/stage.rerun.requested';
  data: { draftId: string; stage: string };
}

const RERUNNABLE_STAGES = [
  'scoping',
  'rules_mechanics',
  'progression',
  'entities',
  'timeline',
  'schema_derivation',
  'rule_pack',
] as const satisfies readonly Exclude<ResearchStage, 'gaps'>[];

export const rerunResearchStage = inngest.createFunction(
  { id: 'rerun-research-stage', retries: 2, triggers: [{ event: 'research/stage.rerun.requested' }] },
  async ({ event, step }: { event: RerunRequestedEvent; step: GetStepTools<typeof inngest> }) => {
    const { draftId, stage } = event.data;

    if (!(RERUNNABLE_STAGES as readonly string[]).includes(stage)) {
      throw new Error(`Stage "${stage}" is not individually re-runnable.`);
    }
    const typedStage = stage as Exclude<ResearchStage, 'gaps'>;

    await step.run('rerun-stage', async () => {
      const supabase = createServiceRoleClient();

      const { data: draftRow, error } = await supabase
        .from('universe_drafts')
        .select('input, owner_id, draft')
        .eq('id', draftId)
        .single();

      if (error !== null || draftRow === null) {
        throw new Error(`Draft ${draftId} not found: ${error?.message ?? 'no row'}`);
      }

      const input = draftRow.input as unknown as DraftInput;
      const draft: DraftDocument = draftDocumentSchema.parse(draftRow.draft ?? {});
      const usage = createUsageRecorder(null, draftRow.owner_id);

      await markJob(draftId, typedStage, { status: 'running' });

      const request = buildStageRequest(typedStage, input, draft);
      const outcome = await runStage({
        stage: typedStage,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        schema: request.schema,
        usage,
      });

      if (outcome.status === 'failed') {
        await markJob(draftId, typedStage, { status: 'failed', last_error: outcome.error });
        return;
      }

      await markJob(draftId, typedStage, { status: 'complete', output: outcome.output });
      const nextDraft = applyStageOutput(draft, typedStage, outcome.output);
      await persistDraft(draftId, nextDraft);
    });

    return { draftId, stage: typedStage };
  },
);
