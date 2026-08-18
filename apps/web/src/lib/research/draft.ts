import { z } from 'zod';

import {
  entitiesResultSchema,
  gapsResultSchema,
  progressionResultSchema,
  rulePackResultSchema,
  rulesResultSchema,
  schemaDerivationResultSchema,
  scopingResultSchema,
  timelineResultSchema,
  type ResearchStage,
} from '@/lib/research/schemas';

/**
 * The accumulating draft document.
 *
 * One optional section per pipeline stage (Part 2.2), each carrying its raw
 * researched content plus a review status the human review workflow drives
 * (universe-review spec, "Section-by-section review"). A section is absent
 * until its stage completes; `applyStageOutput` is the only way a section is
 * added, so the shape stays consistent between the pipeline writer and the
 * review reader.
 */

const sectionStatusSchema = z.enum(['pending', 'accepted', 'edited', 'rejected']);
export type SectionStatus = z.infer<typeof sectionStatusSchema>;

function section<T extends z.ZodTypeAny>(content: T) {
  return z.object({
    status: sectionStatusSchema,
    content,
    /** Present only when status is 'edited' — the user's replacement value. */
    editedContent: content.optional(),
  });
}

/**
 * One AU (alternate-universe) divergence mark on a single fact, keyed by
 * `section` + a dotted `path` into that section's content (the same path
 * shape `gaps.ts` already produces for low-confidence facts). Kept as a
 * side-map rather than a field on every fact wrapper — see universe-review
 * spec "Mark a fact as AU": the original researched value must stay exactly
 * as researched, so the mark cannot live inside the fact itself without
 * mutating it.
 */
const auMarkSchema = z.object({
  section: z.string().min(1),
  path: z.string().min(1),
  divergenceNote: z.string().min(1),
});

export type AuMark = z.infer<typeof auMarkSchema>;

export const draftDocumentSchema = z.object({
  scoping: section(scopingResultSchema).optional(),
  rulesMechanics: section(rulesResultSchema).optional(),
  progression: section(progressionResultSchema).optional(),
  entities: section(entitiesResultSchema).optional(),
  timeline: section(timelineResultSchema).optional(),
  schemaDerivation: section(schemaDerivationResultSchema).optional(),
  rulePack: section(rulePackResultSchema).optional(),
  gaps: section(gapsResultSchema).optional(),
  auMarks: z.array(auMarkSchema).default([]),
});

export type DraftDocument = z.infer<typeof draftDocumentSchema>;

/** Every key on DraftDocument, including the non-section `auMarks` array. */
export type DraftDocumentKey = keyof DraftDocument;

/**
 * Just the eight stage-shaped sections — excludes `auMarks`, which is a flat
 * array, not a `{ status, content }` section. Most code (the gaps walker,
 * stage-request's upstream-context lookup, review actions) only ever wants
 * this narrower set.
 */
export type DraftSectionKey = Exclude<DraftDocumentKey, 'auMarks'>;

/** Maps a `research_jobs.stage` value to the draft section it writes. */
const STAGE_TO_SECTION: Record<ResearchStage, DraftSectionKey> = {
  scoping: 'scoping',
  rules_mechanics: 'rulesMechanics',
  progression: 'progression',
  entities: 'entities',
  timeline: 'timeline',
  schema_derivation: 'schemaDerivation',
  rule_pack: 'rulePack',
  gaps: 'gaps',
};

export function sectionKeyForStage(stage: ResearchStage): DraftSectionKey {
  return STAGE_TO_SECTION[stage];
}

/**
 * Merge one stage's output into the accumulating draft. Pure — the caller
 * persists the result. A re-run (task 4.2) calls this again for the same
 * stage; the new content simply replaces the section, starting it back at
 * `pending` for re-review.
 */
export function applyStageOutput(
  draft: DraftDocument,
  stage: ResearchStage,
  output: unknown,
): DraftDocument {
  const key = sectionKeyForStage(stage);

  return {
    ...draft,
    [key]: { status: 'pending', content: output },
  };
}
