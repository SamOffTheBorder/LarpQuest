import { describe, expect, it } from 'vitest';

import { applicableRules, evaluateRules } from '@/lib/engine/rule-engine';
import type { CanonException, Rule } from '@/lib/engine/rules/types';
import type { ValidatorViolation } from '@/lib/ai/validator-call';

const researchRule = (overrides: Partial<Rule> = {}): Rule => ({
  id: 'research.no_ftl',
  source: 'research',
  check: 'Flag instantaneous coordination across distance.',
  severity: 'block',
  ...overrides,
});

describe('applicableRules', () => {
  it('always includes the standard pack rules that have no applies_when scope', () => {
    const rules = applicableRules([], 'none');
    const ids = rules.map((rule) => rule.id);

    expect(ids).toContain('standard.dead_entity_acts');
    expect(ids).toContain('standard.canon_contradiction');
  });

  it('filters out a standard rule scoped to a progression model the story is not using', () => {
    const rules = applicableRules([], 'none');

    expect(rules.map((rule) => rule.id)).not.toContain('standard.capability_gating');
  });

  it('includes a standard rule scoped to the story\'s active progression model', () => {
    const rules = applicableRules([], 'ability_unlock');

    expect(rules.map((rule) => rule.id)).toContain('standard.capability_gating');
  });

  it('filters a research-derived rule scoped to an inactive progression model', () => {
    const scoped = researchRule({ applies_when: { progression_model_in: ['ability_unlock'] } });
    const rules = applicableRules([scoped], 'none');

    expect(rules.map((rule) => rule.id)).not.toContain(scoped.id);
  });

  it('includes a research-derived rule scoped to the active progression model', () => {
    const scoped = researchRule({ applies_when: { progression_model_in: ['ability_unlock'] } });
    const rules = applicableRules([scoped], 'ability_unlock');

    expect(rules.map((rule) => rule.id)).toContain(scoped.id);
  });

  it('always includes a research-derived rule with no applies_when scope', () => {
    const unscoped = researchRule();
    const rules = applicableRules([unscoped], 'none');

    expect(rules.map((rule) => rule.id)).toContain(unscoped.id);
  });
});

describe('evaluateRules', () => {
  const rules: Rule[] = [researchRule()];

  it('turns a violated rule into a flag carrying that rule\'s severity', () => {
    const violations: ValidatorViolation[] = [
      { rule_id: 'research.no_ftl', violated: true, description: 'Two factions coordinated instantly across star systems.' },
    ];

    const flags = evaluateRules({ rules, violations, canonExceptions: [] });

    expect(flags).toEqual([
      { ruleId: 'research.no_ftl', severity: 'block', description: violations[0]!.description },
    ]);
  });

  it('emits independent flags for multiple violated rules at different severities', () => {
    const twoRules: Rule[] = [researchRule({ id: 'r1', severity: 'block' }), researchRule({ id: 'r2', severity: 'log' })];
    const violations: ValidatorViolation[] = [
      { rule_id: 'r1', violated: true, description: 'block violation' },
      { rule_id: 'r2', violated: true, description: 'log violation' },
    ];

    const flags = evaluateRules({ rules: twoRules, violations, canonExceptions: [] });

    expect(flags).toHaveLength(2);
    expect(flags.find((f) => f.ruleId === 'r1')?.severity).toBe('block');
    expect(flags.find((f) => f.ruleId === 'r2')?.severity).toBe('log');
  });

  it('ignores a violation naming a rule id that was not in the candidate set', () => {
    const violations: ValidatorViolation[] = [{ rule_id: 'unknown.rule', violated: true, description: 'n/a' }];

    const flags = evaluateRules({ rules, violations, canonExceptions: [] });

    expect(flags).toEqual([]);
  });

  it('suppresses a flag matching a story-wide canon exception', () => {
    const violations: ValidatorViolation[] = [
      { rule_id: 'research.no_ftl', violated: true, description: 'violation' },
    ];
    const exceptions: CanonException[] = [{ ruleId: 'research.no_ftl', entityId: null, capabilityId: null }];

    const flags = evaluateRules({ rules, violations, canonExceptions: exceptions });

    expect(flags).toEqual([]);
  });

  it('does not suppress a flag when the exception is scoped to a different entity', () => {
    const violations: ValidatorViolation[] = [
      { rule_id: 'research.no_ftl', violated: true, description: 'violation', entity_id: 'entity-2' },
    ];
    const exceptions: CanonException[] = [{ ruleId: 'research.no_ftl', entityId: 'entity-1', capabilityId: null }];

    const flags = evaluateRules({ rules, violations, canonExceptions: exceptions });

    expect(flags).toHaveLength(1);
  });

  it('is a pure function: identical inputs produce identical output', () => {
    const violations: ValidatorViolation[] = [
      { rule_id: 'research.no_ftl', violated: true, description: 'violation' },
    ];
    const args = { rules, violations, canonExceptions: [] };

    expect(evaluateRules(args)).toEqual(evaluateRules(args));
  });

  it('does not mutate its input arguments', () => {
    const violations: ValidatorViolation[] = [
      { rule_id: 'research.no_ftl', violated: true, description: 'violation' },
    ];
    const rulesCopy = [...rules];
    const violationsCopy = [...violations];

    evaluateRules({ rules: rulesCopy, violations: violationsCopy, canonExceptions: [] });

    expect(rulesCopy).toEqual(rules);
    expect(violationsCopy).toEqual(violations);
  });
});
