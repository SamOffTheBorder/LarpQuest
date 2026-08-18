import { CAPABILITY_STATUSES, type CapabilityStatus } from '@/lib/engine/schema';

/**
 * Progression model dispatch.
 *
 * Models resolve through this table, never through a conditional. Callers
 * resolve a universe version's `progression_model` slug once via
 * `resolveProgressionModel` and use what comes back; they contain no branch
 * on which model they got, and none on genre, universe, or media type — same
 * discipline as `turn-modes.ts`.
 *
 * Phase 2 registers exactly two models (build plan Part 10): `none` and
 * `ability_unlock`. Adding a later one (`numeric_scaling`, etc.) is a new
 * entry here and no change to any caller.
 */

export interface ProgressionModel {
  name: string;
  /**
   * Whether a value transition on a schema field is allowed under this
   * model. Absent means every transition is allowed. Only ever called for
   * fields the model cares about — `ability_unlock` only inspects
   * `capability_list` items; every other field type passes through
   * unchecked by the model (schema-level typing still applies separately).
   */
  validateTransition?(field: { type: string }, from: unknown, to: unknown): boolean;
}

const NONE: ProgressionModel = {
  name: 'none',
};

/**
 * The Part 3.3 capability status lifecycle:
 *   proposed -> developing -> available -> mastered | lost | sealed
 * mastered, lost, and sealed are terminal — no further transition is
 * accepted once a capability reaches one of them.
 */
const ABILITY_UNLOCK_TRANSITIONS: Record<CapabilityStatus, readonly CapabilityStatus[]> = {
  proposed: ['developing'],
  developing: ['available'],
  available: ['mastered', 'lost', 'sealed'],
  mastered: [],
  lost: [],
  sealed: [],
};

function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  return typeof value === 'string' && (CAPABILITY_STATUSES as readonly string[]).includes(value);
}

const ABILITY_UNLOCK: ProgressionModel = {
  name: 'ability_unlock',
  validateTransition(field, from, to) {
    if (field.type !== 'capability_list') {
      return true;
    }

    if (!isCapabilityStatus(from) || !isCapabilityStatus(to)) {
      return false;
    }

    return ABILITY_UNLOCK_TRANSITIONS[from].includes(to);
  },
};

const PROGRESSION_MODELS: Record<string, ProgressionModel> = {
  none: NONE,
  ability_unlock: ABILITY_UNLOCK,
};

export const DEFAULT_PROGRESSION_MODEL = 'none';

export class UnknownProgressionModelError extends Error {
  constructor(readonly progressionModel: string) {
    super(
      `Unknown progression model "${progressionModel}". Registered models: ${Object.keys(PROGRESSION_MODELS).join(', ')}.`,
    );
    this.name = 'UnknownProgressionModelError';
  }
}

export function resolveProgressionModel(progressionModel: string): ProgressionModel {
  const resolved = PROGRESSION_MODELS[progressionModel];

  if (resolved === undefined) {
    throw new UnknownProgressionModelError(progressionModel);
  }

  return resolved;
}

export function registeredProgressionModels(): readonly string[] {
  return Object.keys(PROGRESSION_MODELS);
}
