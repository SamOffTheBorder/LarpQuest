import { untrustedSections, withUntrustedPreamble, type PromptSection } from '@/lib/ai/untrusted';
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

/**
 * Every field here is user-supplied, and `sourceText` in particular is an
 * attacker-controlled document entering the pipeline whose output becomes a
 * universe's canon rules — which then feed the gatekeeper and validator on
 * every subsequent turn. All of it is fenced as untrusted content so a stage
 * reads it as material to research, never as direction about how to research.
 */
function inputContext(input: DraftInput): string {
  const sections: PromptSection[] = [{ heading: 'Universe', untrusted: input.name }];
  if (input.canonCutoff !== undefined) {
    sections.push({ heading: 'Canon cutoff', untrusted: input.canonCutoff });
  }
  if (input.auNotes !== undefined) {
    sections.push({ heading: 'AU/divergence notes', untrusted: input.auNotes });
  }
  if (input.sourceText !== undefined) {
    sections.push({ heading: 'Source material provided by the user', untrusted: input.sourceText });
  }
  return untrustedSections(sections);
}

const SCOPING_SYSTEM_PROMPT_BODY = [
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

const RULES_SYSTEM_PROMPT_BODY = [
  "You are documenting a fictional universe's hard rules: what is possible,",
  'what is impossible, and what has a cost. Produce a list of discrete rule',
  'objects, each with a short id and a description.',
  '',
  CONFIDENCE_INSTRUCTION,
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function buildRulesPrompt(input: DraftInput, scoping: unknown): string {
  return [inputContext(input), untrustedSections([{ heading: 'Scoping (from Stage 1)', untrusted: JSON.stringify(scoping) }])].join('\n\n');
}

const PROGRESSION_SYSTEM_PROMPT_BODY = [
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
  return [inputContext(input), untrustedSections([{ heading: 'Scoping (from Stage 1)', untrusted: JSON.stringify(scoping) }])].join('\n\n');
}

const ENTITIES_SYSTEM_PROMPT_BODY = [
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
    untrustedSections([{ heading: 'Scoping (from Stage 1)', untrusted: JSON.stringify(scoping) }]),
    untrustedSections([{ heading: 'Rules (from Stage 2)', untrusted: JSON.stringify(rules) }]),
  ].join('\n\n');
}

const TIMELINE_SYSTEM_PROMPT_BODY = [
  "You are documenting a fictional universe's timeline and canon state at the",
  'given cutoff: where the story starts, what has already happened, and what',
  'is currently unresolved. This becomes the opening world ledger.',
  '',
  CONFIDENCE_INSTRUCTION,
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function buildTimelinePrompt(input: DraftInput, entities: unknown): string {
  return [inputContext(input), untrustedSections([{ heading: 'Canonical entities (from Stage 4)', untrusted: JSON.stringify(entities) }])].join(
    '\n\n',
  );
}

const SCHEMA_DERIVATION_SYSTEM_PROMPT_BODY = [
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
    untrustedSections([{ heading: 'Scoping (from Stage 1)', untrusted: JSON.stringify(scoping) }]),
    untrustedSections([{ heading: 'Canonical entities (from Stage 4)', untrusted: JSON.stringify(entities) }]),
  ];

  parts.push(
    progression === null
      ? '## Progression (Stage 3)\nSkipped — this universe has no power/progression system.'
      : untrustedSections([{ heading: 'Progression (from Stage 3)', untrusted: JSON.stringify(progression) }]),
  );

  return parts.join('\n\n');
}

const RULE_PACK_SYSTEM_PROMPT_BODY = [
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
    untrustedSections([{ heading: 'Scoping (from Stage 1)', untrusted: JSON.stringify(scoping) }]),
    untrustedSections([{ heading: 'Rules (from Stage 2)', untrusted: JSON.stringify(rules) }]),
  ];

  parts.push(
    progression === null
      ? '## Progression (Stage 3)\nSkipped — this universe has no power/progression system.'
      : untrustedSections([{ heading: 'Progression (from Stage 3)', untrusted: JSON.stringify(progression) }]),
  );

  return parts.join('\n\n');
}

/**
 * Every stage prompt carries the standing data/instruction separation: each
 * one embeds user-supplied input, and stages 2+ additionally embed upstream
 * stage output that was itself derived from that input.
 */
export const SCOPING_SYSTEM_PROMPT = withUntrustedPreamble(SCOPING_SYSTEM_PROMPT_BODY);
export const RULES_SYSTEM_PROMPT = withUntrustedPreamble(RULES_SYSTEM_PROMPT_BODY);
export const PROGRESSION_SYSTEM_PROMPT = withUntrustedPreamble(PROGRESSION_SYSTEM_PROMPT_BODY);
export const ENTITIES_SYSTEM_PROMPT = withUntrustedPreamble(ENTITIES_SYSTEM_PROMPT_BODY);
export const TIMELINE_SYSTEM_PROMPT = withUntrustedPreamble(TIMELINE_SYSTEM_PROMPT_BODY);
export const SCHEMA_DERIVATION_SYSTEM_PROMPT = withUntrustedPreamble(SCHEMA_DERIVATION_SYSTEM_PROMPT_BODY);
export const RULE_PACK_SYSTEM_PROMPT = withUntrustedPreamble(RULE_PACK_SYSTEM_PROMPT_BODY);
