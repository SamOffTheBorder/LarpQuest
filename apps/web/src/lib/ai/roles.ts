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
  'premise',
  'narrator',
  'validator',
  'extractor',
  'summarizer',
  'gatekeeper',
  'embedder',
  'moderator',
  'illustrator',
  'videographer',
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

export const modelRoleSchema = z.enum(MODEL_ROLES);

/**
 * The roles a GM can pick a model for from story settings. Excludes
 * `embedder`, `illustrator`, and `videographer`: those do not speak the
 * chat-completions contract the free-model picker assumes, and their defaults
 * are managed separately (see media-gateway.ts).
 */
export const CONFIGURABLE_TEXT_ROLES = [
  'researcher',
  'narrator',
  'validator',
  'extractor',
  'summarizer',
  'gatekeeper',
  'moderator',
] as const satisfies readonly ModelRole[];

export type ConfigurableTextRole = (typeof CONFIGURABLE_TEXT_ROLES)[number];

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
 *
 * `illustrator` and `videographer` (added Phase 8) are the two roles that do
 * not exclusively speak OpenRouter's chat-completions contract — see
 * `media-gateway.ts`. `illustrator` resolves to an OpenRouter image-output
 * model; `videographer` resolves to a direct provider id (no `/` OpenRouter
 * slug prefix), since no OpenRouter-routable video-generation model exists
 * yet. Both defaults are placeholders pending a live-availability/pricing
 * check identical to the one already done for the text roles above — do not
 * treat either as a confirmed-live id until that check has run.
 */
export const DEFAULT_MODELS: Record<ModelRole, string> = {
  researcher: 'anthropic/claude-opus-4.1',
  // Premise drafting is creative world-building, so it defaults to the same
  // tier as narration. It is a separate role rather than a reuse of
  // `narrator` because the two have genuinely different shapes — structured
  // JSON world-building versus streamed prose — and a GM iterating on
  // premises may well want a cheaper model there while keeping an expensive
  // narrator.
  premise: 'anthropic/claude-sonnet-4.5',
  narrator: 'anthropic/claude-sonnet-4.5',
  validator: 'anthropic/claude-haiku-4.5',
  extractor: 'anthropic/claude-haiku-4.5',
  summarizer: 'anthropic/claude-haiku-4.5',
  gatekeeper: 'anthropic/claude-sonnet-4.5',
  embedder: 'openai/text-embedding-3-small',
  // Cheap and fast: moderation runs once per turn lock on the critical path
  // to generation, and only needs to classify, not write.
  moderator: 'anthropic/claude-haiku-4.5',
  // Routed through OpenRouter's image-output support.
  illustrator: 'google/gemini-2.5-flash-image',
  // Direct provider call, not OpenRouter — see media-gateway.ts.
  videographer: 'kling-v2.1',
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

/**
 * Local-model routing convention.
 *
 * A resolved model string is normally an OpenRouter slug (`anthropic/...`,
 * `openai/...`) — OpenRouter picks the upstream provider server-side. There
 * is no OpenRouter route to a machine's own Ollama install, so a model meant
 * to run locally is written the same way — `<namespace>/<id>` — with the
 * reserved namespace `ollama`, e.g. `ollama/qwen3.6:35b-a3b`. The gateway
 * checks for this prefix and, when present, calls the local Ollama server's
 * OpenAI-compatible endpoint instead of OpenRouter, sending the id with the
 * prefix stripped (Ollama does not know the `ollama/` slug, only its own
 * model names).
 *
 * Keeping this as a string-prefix convention rather than a separate
 * `provider` field on `ModelConfig` means no schema change and no migration:
 * `model_config` is already free-form per-role strings, and every existing
 * caller of `resolveModel` needs no changes at all.
 */
export const OLLAMA_PREFIX = 'ollama/';

export function isOllamaModel(model: string): boolean {
  return model.startsWith(OLLAMA_PREFIX);
}

/** Strip the `ollama/` routing prefix, yielding the id Ollama itself expects. */
export function stripOllamaPrefix(model: string): string {
  return model.slice(OLLAMA_PREFIX.length);
}
