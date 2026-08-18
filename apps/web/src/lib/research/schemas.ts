import { z } from 'zod';

import { entitySchemaSchema } from '@/lib/engine/schema';

/**
 * Research pipeline output schemas (build plan Part 2.2).
 *
 * Every researched fact wraps a value with a confidence level and an
 * optional source, per the universe-review spec's "Fact carries confidence
 * and optional source" requirement. Stage output schemas compose this
 * wrapper rather than each stage inventing its own confidence shape.
 */

function fact<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value,
    confidence: z.enum(['high', 'medium', 'low']),
    source: z.string().min(1).optional(),
  });
}

export type Fact<T> = { value: T; confidence: 'high' | 'medium' | 'low'; source?: string };

/** Stage 1 — Scoping. */
export const scopingResultSchema = z.object({
  media_type: fact(z.string().min(1)),
  genre_tags: fact(z.array(z.string().min(1))),
  has_power_system: fact(z.boolean()),
  power_system_type: fact(z.string().min(1)).optional(),
  scale_ceiling: fact(z.string().min(1)),
  primary_conflict_mode: fact(z.string().min(1)),
  tone: fact(z.array(z.string().min(1))),
  recommended_turn_modes: fact(z.array(z.string().min(1))),
});

export type ScopingResult = z.infer<typeof scopingResultSchema>;

/** Stage 2 — Rules & Mechanics. */
export const rulesResultSchema = z.object({
  rules: z.array(
    z.object({
      id: z.string().min(1),
      description: fact(z.string().min(1)),
    }),
  ),
});

export type RulesResult = z.infer<typeof rulesResultSchema>;

/** Stage 3 — Power/Progression System. Only produced when Stage 1 reports `has_power_system`. */
export const progressionResultSchema = z.object({
  acquisition: fact(z.string().min(1)),
  limits: fact(z.string().min(1)),
  scaling: fact(z.string().min(1)),
  tiers: fact(z.array(z.string().min(1))),
  known_ceiling: fact(z.string().min(1)),
});

export type ProgressionResult = z.infer<typeof progressionResultSchema>;

/** Stage 4 — Canonical Entities. */
export const entitiesResultSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().min(1),
      role: fact(z.string().min(1)),
      capabilities: fact(z.array(z.string())),
      status_at_cutoff: fact(z.string().min(1)),
      key_relationships: fact(z.array(z.string())),
    }),
  ),
});

export type EntitiesResult = z.infer<typeof entitiesResultSchema>;

/** Stage 5 — Timeline & Canon State. */
export const timelineResultSchema = z.object({
  starting_point: fact(z.string().min(1)),
  established_events: fact(z.array(z.string())),
  unresolved_threads: fact(z.array(z.string())),
});

export type TimelineResult = z.infer<typeof timelineResultSchema>;

/**
 * Stage 6 — Schema Derivation. Reuses Phase 2's `entitySchemaSchema` and
 * progression-model vocabulary directly rather than redefining them — the
 * schema this stage proposes is validated by the exact same code a hand-
 * authored universe's schema is (entity-schema spec).
 */
export const schemaDerivationResultSchema = z.object({
  entity_schema: entitySchemaSchema,
  progression_model: z.string().min(1),
  progression_config: z.record(z.string(), z.unknown()).default({}),
});

export type SchemaDerivationResult = z.infer<typeof schemaDerivationResultSchema>;

/** Stage 7 — Rule Pack Generation. Shaped for Part 5.1's validation rule objects. */
export const rulePackResultSchema = z.object({
  rules: z.array(
    z.object({
      id: z.string().min(1),
      source: z.enum(['engine', 'research', 'user']),
      check: z.string().min(1),
      severity: z.enum(['block', 'warn', 'log']),
    }),
  ),
});

export type RulePackResult = z.infer<typeof rulePackResultSchema>;

/** Stage 8 — Confidence & Gaps Report. Built by `gaps.ts`, not model-generated. */
export const gapsResultSchema = z.object({
  low_confidence_facts: z.array(
    z.object({
      section: z.string().min(1),
      path: z.string().min(1),
      value: z.unknown(),
      source: z.string().optional(),
    }),
  ),
  unresolved_stages: z.array(
    z.object({
      stage: z.string().min(1),
      status: z.enum(['failed', 'skipped']),
      reason: z.string().optional(),
    }),
  ),
});

export type GapsResult = z.infer<typeof gapsResultSchema>;

export const RESEARCH_STAGES = [
  'scoping',
  'rules_mechanics',
  'progression',
  'entities',
  'timeline',
  'schema_derivation',
  'rule_pack',
  'gaps',
] as const;

export type ResearchStage = (typeof RESEARCH_STAGES)[number];

export const draftInputSchema = z.object({
  name: z.string().trim().min(1, 'Universe name is required.').max(200),
  sourceText: z.string().max(50_000).optional(),
  canonCutoff: z.string().max(500).optional(),
  auNotes: z.string().max(2_000).optional(),
});

export type DraftInput = z.infer<typeof draftInputSchema>;
