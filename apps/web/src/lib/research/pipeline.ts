import 'server-only';

import { z } from 'zod';

import { callStructured, StructuredOutputError, type UsageRecorder } from '@/lib/ai/gateway';
import { serverEnv } from '@/lib/env';
import type { ScopingResult } from '@/lib/research/schemas';
import type { ResearchStage } from '@/lib/research/schemas';

/**
 * The per-stage research call.
 *
 * Every stage is a `researcher`-role call through the same `callStructured`
 * gateway every other AI call in this codebase uses — one retry on malformed
 * output, then a typed error, and a `usage_log` row on every attempt whether
 * or not it succeeded (ai-gateway spec, unchanged here). A failed stage never
 * throws past this function: the orchestrator (the Inngest function) decides
 * whether to continue, per research-pipeline spec's "One stage's failure does
 * not abort the draft."
 */

export type StageOutcome<T> =
  | { status: 'complete'; output: T }
  | { status: 'failed'; error: string };

export interface RunStageArgs<T> {
  stage: ResearchStage;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  usage: UsageRecorder;
}

export async function runStage<T>(args: RunStageArgs<T>): Promise<StageOutcome<T>> {
  try {
    const result = await callStructured(
      { apiKey: serverEnv().OPENROUTER_API_KEY, usage: args.usage },
      {
        role: 'researcher',
        // Research drafts are user-owned, not story-owned (design.md decision
        // 1) — there is no story model_config to resolve against yet, so
        // every stage runs on the researcher role's documented default.
        modelConfig: null,
        systemPrompt: args.systemPrompt,
        userPrompt: args.userPrompt,
        schema: args.schema,
        storyId: null,
      },
    );

    return { status: 'complete', output: result.data };
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      return { status: 'failed', error: error.message };
    }

    // A transport-level failure (network, non-2xx from OpenRouter) — still
    // typed as a stage failure rather than thrown, for the same reason:
    // Stage 8 must be able to report it as a gap, not crash the pipeline.
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', error: message };
  }
}

/**
 * Stage 3 (Power/Progression) runs only when Stage 1's own output for this
 * draft says so. This reads a boolean the research produced for this specific
 * universe, not a name or genre the engine recognizes — see research-pipeline
 * spec, "Conditional Power/Progression stage."
 */
export function shouldRunProgressionStage(scoping: ScopingResult): boolean {
  return scoping.has_power_system.value;
}
