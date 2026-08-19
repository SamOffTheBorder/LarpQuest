import { z } from 'zod';

/**
 * Shared shapes for the rule engine (rule-engine capability).
 *
 * A `Rule` is data, not code — the same shape whether it came from the
 * engine-provided Standard Rule Pack or a universe's research-derived
 * `validation_rules` (Stage 7 output, `rulePackResultSchema` in
 * lib/research/schemas.ts). Evaluating a rule's natural-language `check`
 * against a chapter draft is a `validator`-role model call (see
 * ai/validator-call.ts); nothing here talks to a model or a database.
 */

export const severitySchema = z.enum(['block', 'warn', 'log']);
export type Severity = z.infer<typeof severitySchema>;

export const ruleApplicabilitySchema = z.object({
  progression_model_in: z.array(z.string().min(1)).optional(),
});
export type RuleApplicability = z.infer<typeof ruleApplicabilitySchema>;

export const ruleSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['engine', 'research', 'user']),
  check: z.string().min(1),
  severity: severitySchema,
  applies_when: ruleApplicabilitySchema.optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

export interface Flag {
  ruleId: string;
  severity: Severity;
  description: string;
  /** Present when the violation is attributable to a specific entity — needed
   * for canon_exceptions scope matching (see rules/exceptions.ts). */
  entityId?: string;
  capabilityId?: string;
}

export interface CanonException {
  ruleId: string;
  entityId: string | null;
  capabilityId: string | null;
}

/** Minimal entity shape the rule engine needs — a subset of engine/entities.ts's Entity. */
export interface RuleEntity {
  id: string;
  type: string;
  name: string;
  status: string;
  data: Record<string, unknown>;
}

export interface RuleEvaluationContext {
  chapterDraft: string;
  progressionModel: string;
  entities: RuleEntity[];
  rules: Rule[];
  canonExceptions: CanonException[];
}
