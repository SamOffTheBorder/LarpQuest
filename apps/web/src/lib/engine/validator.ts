import 'server-only';

import type { ModelConfig } from '@/lib/ai/roles';
import { createUsageRecorder } from '@/lib/ai/usage';
import { runValidatorCall, ValidatorOutputError } from '@/lib/ai/validator-call';
import { applicableRules, evaluateRules } from '@/lib/engine/rule-engine';
import type { CanonException, Flag, Rule, RuleEntity } from '@/lib/engine/rules/types';
import type { Json } from '@/lib/supabase/database.types';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * The validator loop (validator-loop capability).
 *
 * Orchestrates one validation pass on a chapter draft: fetch the story's
 * applicable rules and canon exceptions, run the `validator`-role model call,
 * classify the resulting flags' highest severity, and report what the turn
 * should do next. This module never touches `turns.status` itself — the
 * caller (turns.ts's generateTurn) owns every transition, same as it already
 * owns `generating`/`failed`; `runValidation` only tells it which one to take.
 */

const MAX_BLOCK_RETRIES = 2;

export type ValidationOutcome =
  | { action: 'publish'; flags: Flag[] }
  | { action: 'retry'; flags: Flag[]; blockingRuleIds: string[] }
  | { action: 'fail'; flags: Flag[]; blockingRuleIds: string[] };

export interface RunValidationArgs {
  storyId: string;
  chapterDraft: string;
  attemptCount: number;
  progressionModel: string;
  researchRules: Rule[];
  entities: RuleEntity[];
  canonExceptions: CanonException[];
  modelConfig: ModelConfig | null | undefined;
  userId: string | null;
}

function highestSeverity(flags: Flag[]): 'block' | 'warn' | 'log' | null {
  if (flags.some((flag) => flag.severity === 'block')) return 'block';
  if (flags.some((flag) => flag.severity === 'warn')) return 'warn';
  if (flags.some((flag) => flag.severity === 'log')) return 'log';
  return null;
}

/**
 * Run one validation pass. `attemptCount` is the turn's attempt_count going
 * into this pass (already incremented for the draft just generated) — a
 * block verdict retries while `attemptCount <= MAX_BLOCK_RETRIES`, and fails
 * the turn once that cap is reached, per validator-loop spec's "Retry
 * exhaustion escalates."
 */
export async function runValidation(args: RunValidationArgs): Promise<ValidationOutcome> {
  const rules = applicableRules(args.researchRules, args.progressionModel);

  const violations = await runValidatorCall({
    chapterDraft: args.chapterDraft,
    rules,
    entitiesText: JSON.stringify(args.entities),
    modelConfig: args.modelConfig,
    storyId: args.storyId,
    usage: createUsageRecorder(args.storyId, args.userId),
  });

  const flags = evaluateRules({ rules, violations, canonExceptions: args.canonExceptions });
  const severity = highestSeverity(flags);

  if (severity !== 'block') {
    return { action: 'publish', flags };
  }

  const blockingRuleIds = [...new Set(flags.filter((flag) => flag.severity === 'block').map((flag) => flag.ruleId))];

  if (args.attemptCount <= MAX_BLOCK_RETRIES) {
    return { action: 'retry', flags, blockingRuleIds };
  }

  return { action: 'fail', flags, blockingRuleIds };
}

export { ValidatorOutputError };

/** Fetch the story's canon exceptions for suppression checks. */
export async function loadCanonExceptions(storyId: string): Promise<CanonException[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('canon_exceptions')
    .select('rule_id, entity_id, capability_id')
    .eq('story_id', storyId);

  if (error !== null) {
    throw new Error(`Failed to read canon exceptions: ${error.message}`);
  }

  return data.map((row) => ({
    ruleId: row.rule_id,
    entityId: row.entity_id,
    capabilityId: row.capability_id,
  }));
}

/** Build the violation-appended prompt addendum for a block-triggered retry. */
export function buildBlockRetryAddendum(flags: Flag[]): string {
  const blocking = flags.filter((flag) => flag.severity === 'block');
  const lines = blocking.map((flag) => `- [${flag.ruleId}] ${flag.description}`);

  return [
    'Your previous chapter draft violated the following rules and was rejected.',
    'Write a new version that resolves every violation below while still',
    "addressing the players' submissions:",
    '',
    ...lines,
  ].join('\n');
}

export function toValidationReportJson(flags: Flag[]): Json {
  return toJson(
    flags.map((flag) => ({
      rule_id: flag.ruleId,
      severity: flag.severity,
      description: flag.description,
      entity_id: flag.entityId ?? null,
      capability_id: flag.capabilityId ?? null,
    })),
  );
}
