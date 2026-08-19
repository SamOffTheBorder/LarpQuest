import type { Rule } from '@/lib/engine/rules/types';

/**
 * Whether a rule applies given the story's active progression model. A rule
 * with no `applies_when` always applies — most tone/continuity rules aren't
 * scoped to any particular progression model. Pure function, no DB access.
 */
export function applies(rule: Rule, progressionModel: string): boolean {
  const scope = rule.applies_when?.progression_model_in;

  if (scope === undefined) {
    return true;
  }

  return scope.includes(progressionModel);
}
