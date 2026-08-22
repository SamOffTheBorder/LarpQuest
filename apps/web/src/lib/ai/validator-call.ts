import 'server-only';

import { z } from 'zod';

import { callStructured, StructuredOutputError, type BudgetGuard, type UsageRecorder } from '@/lib/ai/gateway';
import type { ModelConfig } from '@/lib/ai/roles';
import type { Rule } from '@/lib/engine/rules/types';
import { serverEnv } from '@/lib/env';

/**
 * The `validator`-role model call (validator-loop capability).
 *
 * A rule's `check` is natural language (build plan Part 5.1) — evaluating it
 * against a chapter draft is exactly what a model call is for. This module
 * evaluates a whole rule batch in one call rather than one call per rule: the
 * validator only needs to run once per generation attempt, and every rule
 * shares the same chapter draft and entity context.
 *
 * `callStructured` already provides the retry-once-with-error-appended and
 * usage-logging behavior every AI structured output requires (CLAUDE.md
 * rule 7/8) — this module supplies the role, schema, and prompt, and reuses
 * that behavior rather than re-implementing it.
 */

const violationSchema = z.object({
  rule_id: z.string().min(1),
  violated: z.boolean(),
  description: z.string().min(1),
  entity_id: z.string().optional(),
  capability_id: z.string().optional(),
});

const validatorResponseSchema = z.object({
  violations: z.array(violationSchema),
});

export type ValidatorViolation = z.infer<typeof violationSchema>;

export class ValidatorOutputError extends Error {
  constructor(cause: unknown) {
    super('Validator model call failed to produce parseable output after retry.', { cause });
    this.name = 'ValidatorOutputError';
  }
}

const VALIDATOR_SYSTEM_PROMPT = [
  'You are validating a generated chapter draft against a list of rules for',
  'this fictional universe. For every rule, determine whether the chapter',
  'draft violates it. Respond with one entry per rule in `violations`, each',
  'with `rule_id` matching the rule given, `violated` (true/false), a short',
  '`description` of the violation when true (or why it does not apply when',
  'false), and — only when the violation is attributable to one specific',
  'entity or capability — `entity_id`/`capability_id` matching an id given in',
  'context.',
  '',
  'Only report a rule as violated when the chapter draft actually contains',
  'the violation. Do not invent violations to be thorough.',
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

function buildValidatorPrompt(args: {
  chapterDraft: string;
  rules: Rule[];
  entitiesText: string;
}): string {
  const rulesText = args.rules
    .map((rule) => `- id: ${rule.id}\n  severity: ${rule.severity}\n  check: ${rule.check}`)
    .join('\n');

  return [
    `## Chapter draft\n${args.chapterDraft}`,
    `## Entities\n${args.entitiesText}`,
    `## Rules to check\n${rulesText}`,
  ].join('\n\n');
}

export interface RunValidatorCallArgs {
  chapterDraft: string;
  rules: Rule[];
  entitiesText: string;
  modelConfig: ModelConfig | null | undefined;
  storyId: string;
  usage: UsageRecorder;
  budget: BudgetGuard;
}

/**
 * Evaluate a batch of rules against a chapter draft. Returns only the rules
 * the model reported as violated — callers (rule-engine.ts) attach severity
 * and run suppression from there.
 */
export async function runValidatorCall(args: RunValidatorCallArgs): Promise<ValidatorViolation[]> {
  if (args.rules.length === 0) {
    return [];
  }

  try {
    const { data } = await callStructured(
      { apiKey: serverEnv().OPENROUTER_API_KEY, usage: args.usage, budget: args.budget },
      {
        role: 'validator',
        modelConfig: args.modelConfig,
        systemPrompt: VALIDATOR_SYSTEM_PROMPT,
        userPrompt: buildValidatorPrompt(args),
        schema: validatorResponseSchema,
        storyId: args.storyId,
      },
    );

    return data.violations.filter((violation) => violation.violated);
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      throw new ValidatorOutputError(error);
    }

    throw error;
  }
}
