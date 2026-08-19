import type { Rule } from '@/lib/engine/rules/types';

/**
 * The Standard Rule Pack (build plan Part 5.2). Engine-provided, applied to
 * every universe unless a story-wide `canon_exceptions` row disables one of
 * these rule ids — the same suppression mechanism a GM uses to except a
 * single violation also serves as "turn this rule off" when scoped with no
 * entity/capability (see rules/exceptions.ts).
 *
 * Shaped identically to a research-derived rule (`source`, `applies_when`,
 * `check`, `severity`) so `rule-engine.ts` evaluates both through the same
 * code path with no branch on where a rule came from.
 */
export const STANDARD_RULE_PACK: readonly Rule[] = [
  {
    id: 'standard.dead_entity_acts',
    source: 'engine',
    severity: 'block',
    check:
      'Flag any entity whose status is dead, incapacitated, or an equivalent ' +
      'non-functional state taking a deliberate action in the chapter draft. ' +
      'A dead or incapacitated entity cannot act.',
  },
  {
    id: 'standard.simultaneous_location',
    source: 'engine',
    severity: 'block',
    check:
      'Flag any entity depicted as present and acting in two different ' +
      'locations within the same chapter without an explanation (travel, ' +
      'duplication ability, remote presence) established in the entities or ' +
      'prior chapters. An entity cannot be in two places at once.',
  },
  {
    id: 'standard.destroyed_stays_destroyed',
    source: 'engine',
    severity: 'block',
    check:
      'Flag any item or location whose status or established state marks it ' +
      'destroyed, but which the chapter draft treats as intact, present, or ' +
      'usable. Destroyed items and locations remain destroyed.',
  },
  {
    id: 'standard.capability_gating',
    source: 'engine',
    severity: 'block',
    applies_when: { progression_model_in: ['ability_unlock'] },
    check:
      'Flag any use of a capability by an entity where that capability is ' +
      'absent from the entity, or present with status "proposed", ' +
      '"developing", "lost", or "sealed". Only a capability with status ' +
      '"available" or "mastered" may be used.',
  },
  {
    id: 'standard.canon_contradiction',
    source: 'engine',
    severity: 'block',
    check:
      'Flag any statement in the chapter draft that directly contradicts an ' +
      'established canon fact, entity fact, or world-ledger entry supplied in ' +
      'context. Established facts must not be contradicted.',
  },
  {
    id: 'standard.intent_not_addressed',
    source: 'engine',
    severity: 'warn',
    check:
      "Flag any player submission for this turn whose stated intent the " +
      'chapter draft does not address at all — ignoring a submission entirely ' +
      'is a bug even when it breaks no world rule.',
  },
] as const;
