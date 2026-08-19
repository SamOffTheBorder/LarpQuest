import type { CanonException, Flag } from '@/lib/engine/rules/types';

/**
 * Whether a candidate flag is suppressed by an existing canon exception
 * (canon-exceptions capability). The single scope-matching implementation
 * shared by the rule engine and the Gatekeeper, per design.md Decision 2 —
 * both need identical suppression semantics or an override could suppress a
 * validation flag but not the equivalent Gatekeeper rejection, or vice versa.
 *
 * An exception with both entityId and capabilityId null is story-wide for
 * that rule id. An exception scoped to an entity and/or capability only
 * suppresses flags naming that same entity/capability — a flag naming a
 * different entity, or naming none at all, is not suppressed by a
 * narrowly-scoped exception.
 */
export function isSuppressed(flag: Flag, canonExceptions: readonly CanonException[]): boolean {
  return canonExceptions.some((exception) => {
    if (exception.ruleId !== flag.ruleId) {
      return false;
    }

    if (exception.entityId === null && exception.capabilityId === null) {
      return true;
    }

    // A narrowly-scoped exception only suppresses a flag that names the same
    // entity/capability it was scoped to — a flag with no entityId at all
    // does not match an exception scoped to a specific entityId.
    const entityMatches = exception.entityId === null || exception.entityId === (flag.entityId ?? null);
    const capabilityMatches =
      exception.capabilityId === null || exception.capabilityId === (flag.capabilityId ?? null);

    return entityMatches && capabilityMatches;
  });
}
