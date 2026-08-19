import { z } from 'zod';

/**
 * Model roles.
 *
 * Never use one model for everything. Roles have genuinely different
 * requirements — using the expensive creative model to validate JSON wastes
 * money on a narrow task, and using the cheap model to narrate produces prose
 * users will not tolerate.
 *
 * Every model call declares a role. The gateway resolves the actual model
 * string from the story's `model_config`. No call site hardcodes a model.
 */
export const MODEL_ROLES = [
  'researcher',
  'narrator',
  'validator',
  'extractor',
  'summarizer',
  'gatekeeper',
  'embedder',
  'moderator',
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

export const modelRoleSchema = z.enum(MODEL_ROLES);

/**
 * Per-role defaults, used when a story's `model_config` has no entry for a
 * role. The gateway records the fallback rather than failing the call.
 *
 * Only `narrator` and `extractor` run in Phase 1; the rest are here so later
 * phases fill in an entry rather than introducing the concept.
 *
 * Verified against live OpenRouter model availability (2026-08-13, via
 * GET /api/v1/models) — all three ids in active use below (opus-4.1,
 * sonnet-4.5, haiku-4.5) resolve. Re-check if generation starts failing with
 * a model-not-found error; OpenRouter deprecates ids over time.
 */
export const DEFAULT_MODELS: Record<ModelRole, string> = {
  researcher: 'anthropic/claude-opus-4.1',
  narrator: 'anthropic/claude-sonnet-4.5',
  validator: 'anthropic/claude-haiku-4.5',
  extractor: 'anthropic/claude-haiku-4.5',
  summarizer: 'anthropic/claude-haiku-4.5',
  gatekeeper: 'anthropic/claude-sonnet-4.5',
  embedder: 'openai/text-embedding-3-small',
  // Cheap and fast: moderation runs once per turn lock on the critical path
  // to generation, and only needs to classify, not write.
  moderator: 'anthropic/claude-haiku-4.5',
};

/**
 * A story's per-role model overrides. Partial — absent roles fall back to
 * DEFAULT_MODELS. Unknown role names are rejected by `strict()`.
 *
 * Built as an object schema rather than z.record: a record over an enum yields
 * a fully-required Record, which would make a story that configures only
 * `narrator` a type error.
 */
export const modelConfigSchema = z
  .object(
    Object.fromEntries(
      MODEL_ROLES.map((role) => [role, z.string().min(1).optional()]),
    ) as Record<ModelRole, z.ZodOptional<z.ZodString>>,
  )
  .strict();

export type ModelConfig = z.infer<typeof modelConfigSchema>;

/**
 * Seeded into every story at creation so a story is runnable immediately,
 * without the user configuring anything.
 */
export function defaultModelConfig(): ModelConfig {
  return { ...DEFAULT_MODELS };
}

export interface ResolvedModel {
  role: ModelRole;
  model: string;
  /** True when the story had no entry for this role and the default was used. */
  usedFallback: boolean;
}

/**
 * Resolve a role to a concrete model string.
 *
 * A missing role is not an error — it falls back to the documented default and
 * flags it, so a story with a partial config still runs.
 */
export function resolveModel(role: ModelRole, config: ModelConfig | null | undefined): ResolvedModel {
  const configured = config?.[role];

  if (configured !== undefined && configured.length > 0) {
    return { role, model: configured, usedFallback: false };
  }

  return { role, model: DEFAULT_MODELS[role], usedFallback: true };
}
