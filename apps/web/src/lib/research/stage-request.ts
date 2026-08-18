import type { z } from 'zod';

import type { DraftDocument, DraftSectionKey } from '@/lib/research/draft';
import {
  buildEntitiesPrompt,
  buildProgressionPrompt,
  buildRulePackPrompt,
  buildRulesPrompt,
  buildSchemaDerivationPrompt,
  buildScopingPrompt,
  buildTimelinePrompt,
  ENTITIES_SYSTEM_PROMPT,
  PROGRESSION_SYSTEM_PROMPT,
  RULE_PACK_SYSTEM_PROMPT,
  RULES_SYSTEM_PROMPT,
  SCHEMA_DERIVATION_SYSTEM_PROMPT,
  SCOPING_SYSTEM_PROMPT,
  TIMELINE_SYSTEM_PROMPT,
} from '@/lib/research/prompts';
import {
  entitiesResultSchema,
  progressionResultSchema,
  rulePackResultSchema,
  rulesResultSchema,
  schemaDerivationResultSchema,
  scopingResultSchema,
  timelineResultSchema,
  type DraftInput,
  type ResearchStage,
} from '@/lib/research/schemas';

/**
 * Builds the (systemPrompt, userPrompt, schema) triple for one stage, given
 * the draft's input and whatever upstream sections are already in the draft
 * document.
 *
 * This is the single place that knows which stages read which prior
 * sections, so both the full pipeline (`run-research-pipeline.ts`, walking
 * stages fresh from Stage 1) and a single-stage re-run
 * (`rerun-research-stage.ts`, reading upstream context from what's already
 * persisted) build an identical request for a given stage — a re-run must
 * ask the same question the original run did, or "diff against the previous
 * output" (universe-review spec) would be comparing answers to two different
 * questions.
 *
 * Stage 8 (gaps) is intentionally absent — it is not a model call
 * (see gaps.ts) and is never individually re-run through this path.
 */
export interface StageRequest<T> {
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
}

function sectionContent(draft: DraftDocument, key: DraftSectionKey): unknown {
  const section = draft[key];
  if (section === undefined) {
    return null;
  }
  // A user-edited section's edit is authoritative for anything built on top
  // of it — re-deriving from stale researched content after an edit would
  // silently discard the user's correction.
  return section.status === 'edited' ? section.editedContent ?? section.content : section.content;
}

export function buildStageRequest(
  stage: Exclude<ResearchStage, 'gaps'>,
  input: DraftInput,
  draft: DraftDocument,
): StageRequest<unknown> {
  switch (stage) {
    case 'scoping':
      return { systemPrompt: SCOPING_SYSTEM_PROMPT, userPrompt: buildScopingPrompt(input), schema: scopingResultSchema };

    case 'rules_mechanics':
      return {
        systemPrompt: RULES_SYSTEM_PROMPT,
        userPrompt: buildRulesPrompt(input, sectionContent(draft, 'scoping')),
        schema: rulesResultSchema,
      };

    case 'progression':
      return {
        systemPrompt: PROGRESSION_SYSTEM_PROMPT,
        userPrompt: buildProgressionPrompt(input, sectionContent(draft, 'scoping')),
        schema: progressionResultSchema,
      };

    case 'entities':
      return {
        systemPrompt: ENTITIES_SYSTEM_PROMPT,
        userPrompt: buildEntitiesPrompt(input, sectionContent(draft, 'scoping'), sectionContent(draft, 'rulesMechanics')),
        schema: entitiesResultSchema,
      };

    case 'timeline':
      return {
        systemPrompt: TIMELINE_SYSTEM_PROMPT,
        userPrompt: buildTimelinePrompt(input, sectionContent(draft, 'entities')),
        schema: timelineResultSchema,
      };

    case 'schema_derivation':
      return {
        systemPrompt: SCHEMA_DERIVATION_SYSTEM_PROMPT,
        userPrompt: buildSchemaDerivationPrompt(
          input,
          sectionContent(draft, 'scoping'),
          sectionContent(draft, 'progression'),
          sectionContent(draft, 'entities'),
        ),
        schema: schemaDerivationResultSchema,
      };

    case 'rule_pack':
      return {
        systemPrompt: RULE_PACK_SYSTEM_PROMPT,
        userPrompt: buildRulePackPrompt(
          input,
          sectionContent(draft, 'scoping'),
          sectionContent(draft, 'rulesMechanics'),
          sectionContent(draft, 'progression'),
        ),
        schema: rulePackResultSchema,
      };

    default: {
      const exhaustive: never = stage;
      throw new Error(`Unhandled stage: ${JSON.stringify(exhaustive)}`);
    }
  }
}
