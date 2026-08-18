import { z } from 'zod';

import type { EntityData } from '@/lib/engine/context';

/**
 * State diffs.
 *
 * Field-level rather than whole-object replacement. Whole-object replacement
 * makes entity_history useless for understanding what changed, and lets any
 * extractor hallucination silently overwrite unrelated fields.
 *
 * `from` carries the extractor's belief about the previous value, checked
 * against reality before applying — optimistic concurrency against a model
 * that may be working from stale state.
 */

export const diffSchema = z.object({
  entity_id: z.string().uuid(),
  field: z.string().min(1),
  from: z.unknown(),
  to: z.unknown(),
  /** Excerpt from the chapter supporting the claim, so a reviewer can check it. */
  evidence: z.string().min(1),
});

export type Diff = z.infer<typeof diffSchema>;

export const extractionResultSchema = z.object({
  diffs: z.array(diffSchema),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export type DiffRejectionReason = 'unknown_entity' | 'stale_value';

export interface AppliedDiff {
  diff: Diff;
  previous: unknown;
}

export interface RejectedDiff {
  diff: Diff;
  reason: DiffRejectionReason;
  /** What the entity actually held, for a `stale_value` rejection. */
  actual?: unknown;
}

export interface DiffApplicationResult {
  /** Entity id -> its new data. Only entities that actually changed. */
  updated: Map<string, EntityData>;
  applied: AppliedDiff[];
  rejected: RejectedDiff[];
}

/**
 * Deep equality via canonical JSON. Sufficient because entity `data` is jsonb —
 * it holds only JSON-representable values, and object key order is normalized
 * on the way in.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  // Treat absent and null alike: an extractor reporting `from: null` for a
  // field that was simply never set is right about the substance.
  if ((a === undefined || a === null) && (b === undefined || b === null)) {
    return true;
  }

  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonicalize(v)] as const);

    return Object.fromEntries(entries);
  }

  return value;
}

/**
 * Apply a batch of diffs.
 *
 * One bad diff never prevents the rest of the batch from applying — an unknown
 * entity or a stale value is recorded as conflicted for review, and the run
 * continues. Returns new data objects rather than mutating the inputs.
 */
export function applyDiffs(
  entities: ReadonlyMap<string, EntityData>,
  diffs: readonly Diff[],
): DiffApplicationResult {
  const working = new Map<string, EntityData>();
  const applied: AppliedDiff[] = [];
  const rejected: RejectedDiff[] = [];

  for (const diff of diffs) {
    const base = working.get(diff.entity_id) ?? entities.get(diff.entity_id);

    if (base === undefined) {
      rejected.push({ diff, reason: 'unknown_entity' });
      continue;
    }

    const actual = base[diff.field];

    if (!valuesEqual(actual, diff.from)) {
      rejected.push({ diff, reason: 'stale_value', actual });
      continue;
    }

    working.set(diff.entity_id, { ...base, [diff.field]: diff.to });
    applied.push({ diff, previous: actual });
  }

  return { updated: working, applied, rejected };
}

/**
 * Invert an applied diff, for rollback.
 *
 * Rollback writes compensating history rows rather than deleting originals, so
 * the ledger stays append-only and auditable.
 */
export function invertDiff(applied: AppliedDiff): Diff {
  return {
    entity_id: applied.diff.entity_id,
    field: applied.diff.field,
    from: applied.diff.to,
    to: applied.previous,
    evidence: `Reversal of: ${applied.diff.evidence}`,
  };
}
