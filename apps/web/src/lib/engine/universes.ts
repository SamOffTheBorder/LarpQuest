import 'server-only';

import { z } from 'zod';

import { callStructured, StructuredOutputError, type BudgetGuard, type UsageRecorder } from '@/lib/ai/gateway';
import { nullBudgetGuard } from '@/lib/ai/spend';
import { nullUsageRecorder } from '@/lib/ai/usage';
import { entitySchemaSchema, type EntitySchema } from '@/lib/engine/schema';
import { resolveProgressionModel } from '@/lib/engine/progression-models';
import { contextPolicySchema, DEFAULT_CONTEXT_POLICY, type ContextPolicy } from '@/lib/memory/schemas';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * Universe and universe-version persistence.
 *
 * A universe is a named, owned, versioned container for an Entity Schema and
 * a Progression Model (build plan Part 2.4, Part 3). Versions are immutable —
 * `universe_versions` has no update policy — so every write here either
 * creates a universe's first version or appends the next one; nothing ever
 * mutates a published version in place (see universe-versioning spec).
 *
 * Phase 4 adds `context_policy` and two compressed canon-bible
 * representations, generated synchronously here during publish (design.md's
 * resolved "canon compression is synchronous" decision) — a published version
 * is never in a partially-ready state that `assembleContext` could observe.
 */

export const universeVersionInputSchema = z.object({
  name: z.string().trim().min(1, 'Universe name is required.').max(200, 'Name is too long.'),
  entitySchema: entitySchemaSchema,
  progressionModel: z.string().min(1),
  progressionConfig: z.record(z.string(), z.unknown()).default({}),
  /** Free-form canon content (rules, entities, timeline, rule pack, etc.) to
   * compress into the two canon_compression variants. Optional — a universe
   * created without research (or by hand) has no canon bible to compress, and
   * gets null compressed variants, exactly like `canon_compression: 'full'`
   * needs neither. */
  canonBible: z.record(z.string(), z.unknown()).optional(),
  contextPolicy: contextPolicySchema.optional(),
  /** Stage 7 research-derived validation rules (rule-engine capability).
   * Optional — a universe created without research, or before Phase 6, runs
   * the engine-provided Standard Rule Pack only. */
  validationRules: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type UniverseVersionInput = z.infer<typeof universeVersionInputSchema>;

export interface UniverseVersion {
  id: string;
  universeId: string;
  version: number;
  entitySchema: EntitySchema;
  progressionModel: string;
  progressionConfig: Record<string, unknown>;
  contextPolicy: ContextPolicy;
  canonBibleSummary: Record<string, unknown> | null;
  canonBibleRulesOnly: Record<string, unknown> | null;
  validationRules: Record<string, unknown>[];
  publishedAt: string;
}

interface UniverseVersionRow {
  id: string;
  universe_id: string;
  version: number;
  entity_schema: unknown;
  progression_model: string;
  progression_config: unknown;
  context_policy: unknown;
  canon_bible_summary: unknown;
  canon_bible_rules_only: unknown;
  validation_rules: unknown;
  published_at: string;
}

function toUniverseVersion(row: UniverseVersionRow): UniverseVersion {
  return {
    id: row.id,
    universeId: row.universe_id,
    version: row.version,
    // Written only through this module, always parsed by entitySchemaSchema
    // first, so this cast reflects a real invariant rather than asserting one.
    entitySchema: (row.entity_schema ?? { entity_types: {} }) as EntitySchema,
    progressionModel: row.progression_model,
    progressionConfig: (row.progression_config ?? {}) as Record<string, unknown>,
    contextPolicy: (row.context_policy ?? DEFAULT_CONTEXT_POLICY) as ContextPolicy,
    canonBibleSummary: (row.canon_bible_summary ?? null) as Record<string, unknown> | null,
    canonBibleRulesOnly: (row.canon_bible_rules_only ?? null) as Record<string, unknown> | null,
    validationRules: (row.validation_rules ?? []) as Record<string, unknown>[],
    publishedAt: row.published_at,
  };
}

const canonSummarySchema = z.object({ summary: z.string().min(1) });
const canonRulesOnlySchema = z.object({ rules: z.array(z.string().min(1)) });

const CANON_SUMMARY_SYSTEM_PROMPT = [
  'You are compressing a fictional universe\'s canon bible into a concise',
  'summary for use as prompt context. Preserve what a story generator would',
  'need to stay consistent; drop exhaustive detail.',
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

const CANON_RULES_ONLY_SYSTEM_PROMPT = [
  'You are extracting only the hard rules from a fictional universe\'s canon',
  'bible — what is possible, impossible, or has a defined cost. Omit lore,',
  'characters, and narrative detail entirely.',
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

/**
 * Generate both compressed canon-bible representations from whatever canon
 * content is available. Runs at publish time, not per-turn — see
 * context-policy spec, "Compressed canon bible generated at universe-version
 * publish." A universe with no canon bible (created without research) yields
 * null for both; `context_policy.canon_compression: 'full'` needs neither.
 */
async function compressCanonBible(
  canonBible: Record<string, unknown> | undefined,
  usage: UsageRecorder,
  budget: BudgetGuard,
): Promise<{ summary: Record<string, unknown> | null; rulesOnly: Record<string, unknown> | null }> {
  if (canonBible === undefined) {
    return { summary: null, rulesOnly: null };
  }

  const deps = { apiKey: serverEnv().OPENROUTER_API_KEY, usage, budget };
  const canonText = JSON.stringify(canonBible, null, 2);

  const [summaryResult, rulesOnlyResult] = await Promise.all([
    callStructured(deps, {
      role: 'summarizer',
      modelConfig: null,
      systemPrompt: CANON_SUMMARY_SYSTEM_PROMPT,
      userPrompt: canonText,
      schema: canonSummarySchema,
      storyId: null,
    }).catch((error: unknown) => {
      if (error instanceof StructuredOutputError) return null;
      throw error;
    }),
    callStructured(deps, {
      role: 'summarizer',
      modelConfig: null,
      systemPrompt: CANON_RULES_ONLY_SYSTEM_PROMPT,
      userPrompt: canonText,
      schema: canonRulesOnlySchema,
      storyId: null,
    }).catch((error: unknown) => {
      if (error instanceof StructuredOutputError) return null;
      throw error;
    }),
  ]);

  return {
    summary: summaryResult?.data ?? null,
    rulesOnly: rulesOnlyResult?.data ?? null,
  };
}

export interface Universe {
  id: string;
  ownerId: string | null;
  name: string;
  createdAt: string;
}

interface UniverseRow {
  id: string;
  /** Null once the owning account has been deleted; the universe is preserved. */
  owner_id: string | null;
  name: string;
  created_at: string;
}

function toUniverse(row: UniverseRow): Universe {
  return { id: row.id, ownerId: row.owner_id, name: row.name, createdAt: row.created_at };
}

export class UniverseNotFoundError extends Error {
  constructor(readonly universeId: string) {
    super(`Universe ${universeId} not found.`);
    this.name = 'UniverseNotFoundError';
  }
}

export class UniverseVersionNotFoundError extends Error {
  constructor(
    readonly universeId: string,
    readonly version: number,
  ) {
    super(`Universe ${universeId} has no version ${version}.`);
    this.name = 'UniverseVersionNotFoundError';
  }
}

/**
 * Create a universe and publish its first version in one transaction.
 * Rejects unregistered progression models before any database write — a
 * universe naming a model the engine has no dispatch entry for could never
 * run a turn.
 */
export async function createUniverse(
  ownerId: string,
  input: UniverseVersionInput,
  usage: UsageRecorder = nullUsageRecorder,
  budget: BudgetGuard = nullBudgetGuard,
): Promise<UniverseVersion> {
  const parsed = universeVersionInputSchema.parse(input);
  resolveProgressionModel(parsed.progressionModel);

  const contextPolicy = parsed.contextPolicy ?? DEFAULT_CONTEXT_POLICY;
  const { summary, rulesOnly } = await compressCanonBible(parsed.canonBible, usage, budget);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('create_universe_with_version', {
    p_owner_id: ownerId,
    p_name: parsed.name,
    p_entity_schema: toJson(parsed.entitySchema),
    p_progression_model: parsed.progressionModel,
    p_progression_config: toJson(parsed.progressionConfig),
    p_context_policy: toJson(contextPolicy),
    p_canon_bible_summary: toJson(summary),
    p_canon_bible_rules_only: toJson(rulesOnly),
    p_validation_rules: toJson(parsed.validationRules ?? []),
  });

  if (error !== null || data === null) {
    throw new Error(`Failed to create universe: ${error?.message ?? 'no row returned'}`);
  }

  return toUniverseVersion(data as unknown as UniverseVersionRow);
}

/**
 * Publish the next version of an existing universe. The prior version's row
 * is never touched — see universe-versioning spec, "Immutable versions".
 */
export async function publishUniverseVersion(
  universeId: string,
  ownerId: string,
  input: UniverseVersionInput,
  usage: UsageRecorder = nullUsageRecorder,
  budget: BudgetGuard = nullBudgetGuard,
): Promise<UniverseVersion> {
  const parsed = universeVersionInputSchema.parse(input);
  resolveProgressionModel(parsed.progressionModel);

  const contextPolicy = parsed.contextPolicy ?? DEFAULT_CONTEXT_POLICY;
  const { summary, rulesOnly } = await compressCanonBible(parsed.canonBible, usage, budget);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('publish_universe_version', {
    p_universe_id: universeId,
    p_owner_id: ownerId,
    p_entity_schema: toJson(parsed.entitySchema),
    p_progression_model: parsed.progressionModel,
    p_progression_config: toJson(parsed.progressionConfig),
    p_context_policy: toJson(contextPolicy),
    p_canon_bible_summary: toJson(summary),
    p_canon_bible_rules_only: toJson(rulesOnly),
    p_validation_rules: toJson(parsed.validationRules ?? []),
  });

  if (error !== null || data === null) {
    throw new Error(`Failed to publish universe version: ${error?.message ?? 'no row returned'}`);
  }

  return toUniverseVersion(data as unknown as UniverseVersionRow);
}

export async function getUniverse(universeId: string): Promise<Universe> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('universes')
    .select('id, owner_id, name, created_at')
    .eq('id', universeId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read universe: ${error.message}`);
  }

  if (data === null) {
    throw new UniverseNotFoundError(universeId);
  }

  return toUniverse(data);
}

export async function getUniverseVersion(
  universeId: string,
  version: number,
): Promise<UniverseVersion> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('universe_versions')
    .select('id, universe_id, version, entity_schema, progression_model, progression_config, context_policy, canon_bible_summary, canon_bible_rules_only, validation_rules, published_at')
    .eq('universe_id', universeId)
    .eq('version', version)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read universe version: ${error.message}`);
  }

  if (data === null) {
    throw new UniverseVersionNotFoundError(universeId, version);
  }

  return toUniverseVersion(data);
}

/** Highest published version for a universe. Used when pinning a new story. */
export async function getLatestUniverseVersion(universeId: string): Promise<UniverseVersion> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('universe_versions')
    .select('id, universe_id, version, entity_schema, progression_model, progression_config, context_policy, canon_bible_summary, canon_bible_rules_only, validation_rules, published_at')
    .eq('universe_id', universeId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read latest universe version: ${error.message}`);
  }

  if (data === null) {
    throw new UniverseNotFoundError(universeId);
  }

  return toUniverseVersion(data);
}
