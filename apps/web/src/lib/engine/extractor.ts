/**
 * The extractor prompt.
 *
 * Turns a published chapter's prose into diffs against the entities it
 * touched. This is deliberately generic: it names no fields, no genre, no
 * universe. `extractionTargets` (from the turn mode) are passed through as
 * hints, not interpreted — the engine never inspects what they mean.
 */

export interface ExtractorEntityContext {
  id: string;
  type: string;
  name: string;
  data: Record<string, unknown>;
}

export interface BuildExtractorPromptArgs {
  chapterProse: string;
  entities: readonly ExtractorEntityContext[];
  extractionTargets: readonly string[];
}

export const EXTRACTOR_SYSTEM_PROMPT = [
  'You extract state changes from a story chapter into structured diffs.',
  '',
  'You will be given the chapter text and the current state of every entity',
  'that might be affected. For each fact the chapter establishes or changes',
  'about an entity, produce one diff: the entity id, the field name, its value',
  "before this chapter (from the entity's current state), its value after, and",
  'a short quote from the chapter as evidence.',
  '',
  'Rules:',
  '- Only extract what the chapter text actually supports. Do not infer beyond',
  '  what is written.',
  '- `from` must match the entity\'s current value for that field exactly, or',
  '  the diff will be rejected. If a field has no current value, use null.',
  '- Use field names that fit the entity naturally. You are not restricted to',
  '  any fixed schema — invent whatever field names the story calls for.',
  '- If nothing changed for an entity, produce no diff for it.',
  '- Never invent an entity id. Only use ids from the list you were given.',
  '',
  'Respond with JSON only: {"diffs": [{"entity_id", "field", "from", "to", "evidence"}]}',
].join('\n');

function renderEntity(entity: ExtractorEntityContext): string {
  return `- id: ${entity.id}\n  name: ${entity.name} (${entity.type})\n  current state: ${JSON.stringify(entity.data)}`;
}

export function buildExtractorPrompt(args: BuildExtractorPromptArgs): string {
  const entitySection =
    args.entities.length > 0
      ? args.entities.map(renderEntity).join('\n')
      : '(no entities in this story yet)';

  const focusSection =
    args.extractionTargets.length > 0
      ? `\n\nPay particular attention to: ${args.extractionTargets.join(', ')}.`
      : '';

  return [
    `## Chapter\n${args.chapterProse}`,
    `## Entities\n${entitySection}`,
    `Extract diffs for what changed.${focusSection}`,
  ].join('\n\n');
}
