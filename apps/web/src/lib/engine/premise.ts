import 'server-only';

import { resolveUserApiKey } from '@/lib/ai/api-key';
import { callStructured, StructuredOutputError } from '@/lib/ai/gateway';
import { buildPremisePrompt, buildRegeneratePrompt, premiseSystemPrompt } from '@/lib/ai/premise-prompt';
import { defaultModelConfig } from '@/lib/ai/roles';
import { createBudgetGuard } from '@/lib/ai/spend';
import { createUsageRecorder } from '@/lib/ai/usage';
import { createEntity } from '@/lib/engine/entities';
import {
  getPremiseDraft,
  markPremiseDraftApproved,
  savePremiseDocument,
  type PremiseDraft,
} from '@/lib/engine/premise-drafts';
import {
  effectiveContent,
  generatedPremiseSchema,
  fromGenerated,
  isPinned,
  keptCast,
  premiseDocumentSchema,
  PREMISE_SECTION_KEYS,
  type PremiseDocument,
  type PremiseInput,
  type PremiseSectionKey,
} from '@/lib/engine/premise-schema';
import { createStory } from '@/lib/engine/stories';
import { getLatestUniverseVersion } from '@/lib/engine/universes';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * Premise generation, review, and approval.
 *
 * The premise step runs before any story exists, which shapes three things:
 * the model config is the project default rather than a story's overrides,
 * usage and spend are attributed to the user rather than a story, and the API
 * key resolves from the user's own stored key or the platform fallback (there
 * is no story whose GM could supply one).
 *
 * Generation runs inline rather than through Inngest: it is one call taking
 * seconds, and a failure is recoverable by pressing the button again — the
 * GM's typed intent is already persisted on the draft, so nothing is retyped.
 */

export class PremiseGenerationError extends Error {
  constructor(override readonly cause: unknown) {
    super('The premise could not be generated. Try again.');
    this.name = 'PremiseGenerationError';
  }
}

export class NothingToRegenerateError extends Error {
  constructor() {
    super('Every section is kept — cut or edit a section before regenerating.');
    this.name = 'NothingToRegenerateError';
  }
}

/**
 * Canon context for a universe-pinned premise, as compact text.
 *
 * The rules-only bible is preferred over the full summary: a premise needs to
 * know what the world permits, not its entire history, and the shorter
 * context leaves more budget for the premise itself.
 */
async function canonContextFor(universeId: string | null): Promise<string | null> {
  if (universeId === null) {
    return null;
  }

  try {
    const version = await getLatestUniverseVersion(universeId);
    const canon = version.canonBibleRulesOnly ?? version.canonBibleSummary;

    return canon === null ? null : JSON.stringify(canon);
  } catch {
    // A premise is still worth generating without canon — better a slightly
    // less grounded premise than a hard failure at story creation.
    return null;
  }
}

async function callPremiseModel(
  userId: string,
  input: PremiseInput,
  userPrompt: string,
): Promise<PremiseDocument> {
  try {
    const { data } = await callStructured(
      {
        apiKey: (await resolveUserApiKey(userId)).key,
        usage: createUsageRecorder(null, userId),
        budget: createBudgetGuard(null, userId),
      },
      {
        role: 'premise',
        // No story exists, so there are no per-story overrides to consult;
        // the role still resolves through the role table, as constraint #6
        // requires, and records the fallback.
        modelConfig: defaultModelConfig(),
        systemPrompt: premiseSystemPrompt(input.contentRating),
        userPrompt,
        schema: generatedPremiseSchema,
        storyId: null,
      },
    );

    return fromGenerated(data);
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      throw new PremiseGenerationError(error);
    }
    throw error;
  }
}

/**
 * First generation. On any failure the draft is left exactly as it was, so
 * the GM's intent survives and the action is retryable.
 */
export async function generatePremise(draftId: string, userId: string): Promise<PremiseDraft> {
  const draft = await getPremiseDraft(draftId, userId);
  const canon = await canonContextFor(draft.input.universeId);

  const document = await callPremiseModel(
    userId,
    draft.input,
    buildPremisePrompt(draft.input, canon),
  );

  return savePremiseDocument(draftId, userId, document);
}

/**
 * Regenerate the sections the owner has not settled.
 *
 * Pinned sections are supplied to the model as constraints *and* restored
 * from stored content afterward (design.md decision 3). Both halves matter:
 * the prompt keeps regenerated sections coherent with the kept ones, and the
 * merge guarantees a kept section survives byte-identical even if the model
 * rewrites it anyway. Prompting alone would risk silent drift in a section
 * the owner already approved.
 */
export async function regeneratePremise(draftId: string, userId: string): Promise<PremiseDraft> {
  const draft = await getPremiseDraft(draftId, userId);

  if (draft.premise === null) {
    return generatePremise(draftId, userId);
  }

  const current = draft.premise;
  const regenerating = PREMISE_SECTION_KEYS.filter((key) => !isPinned(current[key].status));

  if (regenerating.length === 0) {
    throw new NothingToRegenerateError();
  }

  const canon = await canonContextFor(draft.input.universeId);

  const fresh = await callPremiseModel(
    userId,
    draft.input,
    buildRegeneratePrompt(draft.input, current, regenerating, draft.notes, canon),
  );

  const merged = premiseDocumentSchema.parse({
    // A regenerated premise may well warrant a new title, but a settled one
    // should not move under the owner. Keep the existing title unless every
    // section was being regenerated anyway.
    title: regenerating.length === PREMISE_SECTION_KEYS.length ? fresh.title : current.title,
    ...Object.fromEntries(
      PREMISE_SECTION_KEYS.map((key) => [key, isPinned(current[key].status) ? current[key] : fresh[key]]),
    ),
  });

  return savePremiseDocument(draftId, userId, merged);
}

/** Mark a section kept as generated. */
export async function acceptSection(
  draftId: string,
  userId: string,
  key: PremiseSectionKey,
): Promise<PremiseDraft> {
  return updateSection(draftId, userId, key, (section) => ({ ...section, status: 'accepted' }));
}

/**
 * Cut a section. Its generated content is retained rather than deleted, so
 * the cut can be reversed and so the approval step can tell "rejected" from
 * "never generated".
 */
export async function rejectSection(
  draftId: string,
  userId: string,
  key: PremiseSectionKey,
): Promise<PremiseDraft> {
  return updateSection(draftId, userId, key, (section) => ({ ...section, status: 'rejected' }));
}

/**
 * Replace a section's content with the owner's own. Stored separately from
 * the generated content, and attributed as `edited` rather than presented as
 * model output — same discipline as `lib/research/review.ts`.
 */
export async function editSection(
  draftId: string,
  userId: string,
  key: PremiseSectionKey,
  editedContent: unknown,
): Promise<PremiseDraft> {
  return updateSection(draftId, userId, key, (section) => ({
    ...section,
    status: 'edited',
    editedContent,
  }));
}

/**
 * Cut or restore one cast member (design.md decision 9).
 *
 * The member is retained either way — a cut is reversible, and regeneration
 * needs to see what was rejected rather than silently reproposing it.
 */
export async function setCastMemberKept(
  draftId: string,
  userId: string,
  index: number,
  kept: boolean,
): Promise<PremiseDraft> {
  const draft = await requirePremise(draftId, userId);
  const cast = effectiveContent(draft.premise, 'cast');

  if (index < 0 || index >= cast.length) {
    throw new Error(`No cast member at index ${index}.`);
  }

  const nextCast = cast.map((member, position) =>
    position === index ? { ...member, kept } : member,
  );

  // Writing through editedContent keeps the model's original cast recoverable,
  // exactly as a text edit does.
  const next = premiseDocumentSchema.parse({
    ...draft.premise,
    cast: {
      ...draft.premise.cast,
      status: draft.premise.cast.status === 'rejected' ? 'rejected' : 'edited',
      editedContent: nextCast,
    },
  });

  return savePremiseDocument(draftId, userId, next);
}

async function requirePremise(
  draftId: string,
  userId: string,
): Promise<PremiseDraft & { premise: PremiseDocument }> {
  const draft = await getPremiseDraft(draftId, userId);

  if (draft.premise === null) {
    throw new Error('This draft has no premise yet.');
  }

  return draft as PremiseDraft & { premise: PremiseDocument };
}

async function updateSection(
  draftId: string,
  userId: string,
  key: PremiseSectionKey,
  mutate: (section: PremiseDocument[PremiseSectionKey]) => unknown,
): Promise<PremiseDraft> {
  const draft = await requirePremise(draftId, userId);

  const next = premiseDocumentSchema.parse({
    ...draft.premise,
    [key]: mutate(draft.premise[key]),
  });

  return savePremiseDocument(draftId, userId, next);
}

/** One cast member that could not be seeded, reported rather than thrown. */
export interface FailedCastMember {
  name: string;
  reason: string;
}

export interface ApprovedPremise {
  storyId: string;
  /** Empty when every kept cast member was created. */
  failedCast: FailedCastMember[];
}

/**
 * Resolve the premise to what the owner actually approved: edits win over
 * generated content, and rejected sections are omitted entirely.
 */
function resolveLedger(document: PremiseDocument): Record<string, unknown> {
  const ledger: Record<string, unknown> = { title: document.title };

  for (const key of PREMISE_SECTION_KEYS) {
    if (document[key].status === 'rejected') {
      continue;
    }
    ledger[key] = key === 'cast' ? keptCast(document) : effectiveContent(document, key);
  }

  return ledger;
}

/**
 * Create the story this premise describes, seed its world ledger, and create
 * the kept cast as entities.
 *
 * Entities go through `createEntity` rather than a bulk insert so each writes
 * its `entity_history` row (constraint #3) and is validated against any
 * pinned universe schema. That is also why partial failure is possible: the
 * story exists before the entities do. When a cast member fails we keep the
 * story and report the failure rather than rolling back — discarding a valid
 * story and a completed review over one fixable entity would be worse, and
 * the GM can add the missing character by hand.
 */
export async function approvePremise(draftId: string, userId: string): Promise<ApprovedPremise> {
  const draft = await requirePremise(draftId, userId);
  const document = draft.premise;

  const story = await createStory(userId, {
    title: document.title,
    contentRating: draft.input.contentRating,
    universeId: draft.input.universeId,
  });

  const supabase = createServiceRoleClient();
  const { error: ledgerError } = await supabase
    .from('stories')
    .update({ world_ledger: toJson({ premise: resolveLedger(document) }) })
    .eq('id', story.id);

  if (ledgerError !== null) {
    throw new Error(`Failed to seed world ledger: ${ledgerError.message}`);
  }

  const failedCast: FailedCastMember[] = [];

  for (const member of keptCast(document)) {
    try {
      await createEntity(story.id, userId, {
        type: member.type,
        name: member.name,
        data: { role: member.role, description: member.description },
        controlledBy: null,
      });
    } catch (error) {
      failedCast.push({
        name: member.name,
        reason: error instanceof Error ? error.message : 'Unknown error.',
      });
    }
  }

  await markPremiseDraftApproved(draftId, userId, story.id);

  return { storyId: story.id, failedCast };
}
