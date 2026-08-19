import type { DraftInput } from '@/lib/research/schemas';

/**
 * Stage prompts (build plan Part 2.2). Each builder receives only the prior
 * stages' output it actually depends on — never the whole draft — so a
 * missing/failed upstream stage is a visible, typed gap in that function's
 * signature rather than an implicit null buried in a giant context object.
 *
 * Every prompt is generic across universes: nothing here names a genre, a
 * franchise, or a media type. The model is asked to research and describe;
 * this module only shapes how the question is asked and where the "state
 * your confidence and, if possible, a source" instruction goes, since that
 * instruction is identical for every stage.
 */

const CONFIDENCE_INSTRUCTION =
  'For every fact you report, include a confidence of "high", "medium", or ' +
  '"low", and a source (a title, edition, or specific reference) when you can ' +
  'identify one. Mark confidence "low" rather than guessing when you are not ' +
  'sure — a visible gap is more useful than a confident-sounding fabrication.';

function inputContext(input: DraftInput): string {
  const lines = [`Universe: ${input.name}`];
  if (input.canonCutoff !== undefined) lines.push(`Canon cutoff: ${input.canonCutoff}`);
  if (input.auNotes !== undefined) lines.push(`AU/divergence notes: ${input.auNotes}`);
  if (input.sourceText !== undefined) lines.push(`\nSource material provided by the user:\n${input.sourceText}`);
  return lines.join('\n');
}

export const SCOPING_SYSTEM_PROMPT = [
  'You are researching a fictional universe to classify it before deeper',
  'research begins. Identify what kind of universe this is: its media type,',
  'genre, whether it has a power/ability system, its scale, its primary',
  'conflict mode, its tone, and which turn modes would suit stories in it',
  '(from: action, scene, investigation, dialogue, montage, freeform).',
  '',
  CONFIDENCE_INSTRUCTION,
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function buildScopingPrompt(input: DraftInput): string {
  return inputContext(input);
}

export const RULES_SYSTEM_PROMPT = [
  "You are documenting a fictional universe's hard rules: what is possible,",
  'what is impossible, and what has a cost. Produce a list of discrete rule',
  'objects, each with a short id and a description.',
  '',
  CONFIDENCE_INSTRUCTION,
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function buildRulesPrompt(input: DraftInput, scoping: unknown): string {
  return [inputContext(input), `## Scoping (from Stage 1)\n${JSON.stringify(scoping)}`].join('\n\n');
}

export const PROGRESSION_SYSTEM_PROMPT = [
  "You are documenting a fictional universe's power or progression system in",
  'depth: how abilities/power are gained, what limits exist, how scaling',
  'works, what established tiers exist, and what the known ceiling is. This',
  'document matters more than any other stage for keeping a long-running',
  'story coherent — be thorough.',
  '',
  CONFIDENCE_INSTRUCTION,
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function buildProgressionPrompt(input: DraftInput, scoping: unknown): string {
  return [inputContext(input), `## Scoping (from Stage 1)\n${JSON.stringify(scoping)}`].join('\n\n');
}

export const ENTITIES_SYSTEM_PROMPT = [
  'You are documenting the major canonical entities of a fictional universe:',
  'characters, factions, and locations. For each, give a name, role,',
  'capabilities, status at the canon cutoff (flag anyone dead or',
  'incapacitated), and key relationships.',
  '',
  CONFIDENCE_INSTRUCTION,
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function buildEntitiesPrompt(
  input: DraftInput,
  scoping: unknown,
  rules: unknown,
): string {
  return [
    inputContext(input),
    `## Scoping (from Stage 1)\n${JSON.stringify(scoping)}`,
    `## Rules (from Stage 2)\n${JSON.stringify(rules)}`,
  ].join('\n\n');
}

export const TIMELINE_SYSTEM_PROMPT = [
  "You are documenting a fictional universe's timeline and canon state at the",
  'given cutoff: where the story starts, what has already happened, and what',
  'is currently unresolved. This becomes the opening world ledger.',
  '',
  CONFIDENCE_INSTRUCTION,
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function buildTimelinePrompt(input: DraftInput, entities: unknown): string {
  return [inputContext(input), `## Canonical entities (from Stage 4)\n${JSON.stringify(entities)}`].join(
    '\n\n',
  );
}

export const SCHEMA_DERIVATION_SYSTEM_PROMPT = [
  'You are deriving an Entity Schema and Progression Model for a fictional',
  'universe from research already gathered, not choosing from a fixed menu.',
  '',
  'The engine provides exactly eleven field-type primitives an entity_schema',
  'may use: string, text, enum, number, resource, capability_list,',
  'relationship_map, knowledge_set, standing_map, tag_list, reference.',
  'Compose entity types (e.g. "character", "faction", "location") out of',
  'these primitives only — do not invent a new field type.',
  '',
  'The engine provides these progression_model slugs: none, ability_unlock,',
  'numeric_scaling, skill_tree, resource_cost, knowledge_state,',
  'relationship_web, reputation. Choose exactly one that fits what the',
  'research found (or "none" if the universe has no progression to track),',
  'and supply a matching progression_config.',
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function buildSchemaDerivationPrompt(
  input: DraftInput,
  scoping: unknown,
  progression: unknown | null,
  entities: unknown,
): string {
  const parts = [
    inputContext(input),
    `## Scoping (from Stage 1)\n${JSON.stringify(scoping)}`,
    `## Canonical entities (from Stage 4)\n${JSON.stringify(entities)}`,
  ];

  parts.push(
    progression === null
      ? '## Progression (Stage 3)\nSkipped — this universe has no power/progression system.'
      : `## Progression (from Stage 3)\n${JSON.stringify(progression)}`,
  );

  return parts.join('\n\n');
}

export const RULE_PACK_SYSTEM_PROMPT = [
  'You are converting researched rules into a validation rule pack. Each rule',
  'needs a short id, a source of "research" (you are generating it from prior',
  'stages, never "engine" or "user"), a check describing what to flag in',
  'plain language, and a severity: "block" for a hard violation that should',
  'stop publication, "warn" for something to flag but allow, "log" for silent',
  'record-keeping. Include tone rules where relevant (e.g. a comedy drifting',
  'grimdark, a horror losing its edge) — tone rules matter as much as',
  'mechanical rules.',
  '',
  'A rule may optionally include applies_when: { progression_model_in: [...] }',
  'to scope it to specific progression models (for example, a capability-',
  'gating rule that only makes sense when this universe uses "ability_unlock").',
  'Omit applies_when entirely for a rule that should always be evaluated',
  'regardless of progression model, such as most tone or continuity rules.',
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function buildRulePackPrompt(
  input: DraftInput,
  scoping: unknown,
  rules: unknown,
  progression: unknown | null,
): string {
  const parts = [
    inputContext(input),
    `## Scoping (from Stage 1)\n${JSON.stringify(scoping)}`,
    `## Rules (from Stage 2)\n${JSON.stringify(rules)}`,
  ];

  parts.push(
    progression === null
      ? '## Progression (Stage 3)\nSkipped — this universe has no power/progression system.'
      : `## Progression (from Stage 3)\n${JSON.stringify(progression)}`,
  );

  return parts.join('\n\n');
}
