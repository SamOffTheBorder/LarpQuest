import { applies } from '@/lib/engine/rules/applicability';
import { isSuppressed } from '@/lib/engine/rules/exceptions';
import { STANDARD_RULE_PACK } from '@/lib/engine/rules/standard-pack';
import type { CanonException, Flag, Rule } from '@/lib/engine/rules/types';
import type { ValidatorViolation } from '@/lib/ai/validator-call';

/**
 * The rule engine (rule-engine capability).
 *
 * `applicableRules` and `evaluateRules` are pure — no model calls, no
 * database access, no side effects (rule-engine spec, "Pure evaluation
 * function"). The `validator`-role model call that actually judges a chapter
 * draft against a rule's natural-language `check` lives in
 * ai/validator-call.ts and is invoked by the orchestrator (validator.ts),
 * which passes its raw output into `evaluateRules` here. This keeps rule
 * filtering and suppression testable without mocking the model layer, and
 * keeps severity/suppression logic in exactly one place shared by every
 * caller.
 *
 * Every rule is data — this module contains no conditional on genre,
 * universe, or media type, only on the bounded
 * `applies_when.progression_model_in` vocabulary every universe shares.
 */

/**
 * The rules a story should evaluate this turn: the Standard Rule Pack plus
 * the universe's research-derived `validation_rules`, filtered to those
 * whose `applies_when` matches the story's active progression model.
 */
export function applicableRules(researchRules: Rule[], progressionModel: string): Rule[] {
  return [...STANDARD_RULE_PACK, ...researchRules].filter((rule) => applies(rule, progressionModel));
}

export interface EvaluateRulesArgs {
  rules: Rule[];
  violations: ValidatorViolation[];
  canonExceptions: CanonException[];
}

/**
 * Turn a validator call's raw violations into the final, suppression-filtered
 * flag set. Pure: same inputs always produce the same output, no side
 * effects on any argument.
 */
export function evaluateRules(args: EvaluateRulesArgs): Flag[] {
  const ruleById = new Map<string, Rule>(args.rules.map((rule) => [rule.id, rule]));

  const flags: Flag[] = args.violations
    .map((violation): Flag | null => {
      const rule = ruleById.get(violation.rule_id);
      if (rule === undefined) {
        // The model named a rule id we never gave it — ignore rather than
        // trust an unverifiable severity.
        return null;
      }

      return {
        ruleId: rule.id,
        severity: rule.severity,
        description: violation.description,
        ...(violation.entity_id !== undefined ? { entityId: violation.entity_id } : {}),
        ...(violation.capability_id !== undefined ? { capabilityId: violation.capability_id } : {}),
      };
    })
    .filter((flag): flag is Flag => flag !== null);

  return flags.filter((flag) => !isSuppressed(flag, args.canonExceptions));
}
