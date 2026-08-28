import 'server-only';

import { premiseDocumentSchema, premiseInputSchema, type PremiseDocument, type PremiseInput } from '@/lib/engine/premise-schema';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * Premise draft persistence.
 *
 * A draft is owned by one user and never gated through `story_members` — no
 * story exists while the premise is being reviewed. Every read checks
 * `owner_id` explicitly rather than relying on RLS, because the service-role
 * client bypasses RLS; this is the same discipline `lib/research/drafts.ts`
 * and `lib/engine/stories.ts` already follow.
 */

export class PremiseDraftNotFoundError extends Error {
  constructor(readonly draftId: string) {
    // A non-owner and a nonexistent draft must look identical to the caller.
    super(`Premise draft ${draftId} not found.`);
    this.name = 'PremiseDraftNotFoundError';
  }
}

export type PremiseDraftStatus = 'draft' | 'approved' | 'abandoned';

export interface PremiseDraft {
  id: string;
  /** Null once the owning account has been deleted; the draft is preserved. */
  ownerId: string | null;
  status: PremiseDraftStatus;
  input: PremiseInput;
  /** Null until the first generation completes. */
  premise: PremiseDocument | null;
  notes: string;
  storyId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PremiseDraftRow {
  id: string;
  owner_id: string | null;
  status: string;
  input: unknown;
  premise: unknown;
  notes: string | null;
  story_id: string | null;
  created_at: string;
  updated_at: string;
}

const DRAFT_COLUMNS =
  'id, owner_id, status, input, premise, notes, story_id, created_at, updated_at';

/**
 * `premise` is `{}` between draft creation and the first successful
 * generation, which is not a valid document — hence the null rather than a
 * parse failure. Every writer goes through this module, so anything non-empty
 * was written as a parsed document.
 */
function toPremiseDraft(row: PremiseDraftRow): PremiseDraft {
  const rawPremise = row.premise;
  const hasPremise =
    rawPremise !== null &&
    typeof rawPremise === 'object' &&
    Object.keys(rawPremise as Record<string, unknown>).length > 0;

  return {
    id: row.id,
    ownerId: row.owner_id,
    status: row.status as PremiseDraftStatus,
    input: premiseInputSchema.parse(row.input),
    premise: hasPremise ? premiseDocumentSchema.parse(rawPremise) : null,
    notes: row.notes ?? '',
    storyId: row.story_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Create a draft holding the GM's intent. No model call happens here. */
export async function createPremiseDraft(
  ownerId: string,
  input: PremiseInput,
): Promise<PremiseDraft> {
  const parsed = premiseInputSchema.parse(input);
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('story_premise_drafts')
    .insert({ owner_id: ownerId, input: toJson(parsed), status: 'draft' })
    .select(DRAFT_COLUMNS)
    .single();

  if (error !== null || data === null) {
    throw new Error(`Failed to create premise draft: ${error?.message ?? 'no row returned'}`);
  }

  return toPremiseDraft(data);
}

export async function getPremiseDraft(draftId: string, ownerId: string): Promise<PremiseDraft> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('story_premise_drafts')
    .select(DRAFT_COLUMNS)
    .eq('id', draftId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read premise draft: ${error.message}`);
  }

  if (data === null || data.owner_id !== ownerId) {
    throw new PremiseDraftNotFoundError(draftId);
  }

  return toPremiseDraft(data);
}

/** List the owner's drafts, newest first. */
export async function listPremiseDrafts(ownerId: string): Promise<PremiseDraft[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('story_premise_drafts')
    .select(DRAFT_COLUMNS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to list premise drafts: ${error.message}`);
  }

  return (data ?? []).map(toPremiseDraft);
}

/**
 * Replace the draft's premise document. Ownership is checked first, so a
 * non-owner cannot write through this path.
 */
export async function savePremiseDocument(
  draftId: string,
  ownerId: string,
  premise: PremiseDocument,
): Promise<PremiseDraft> {
  await getPremiseDraft(draftId, ownerId);

  const parsed = premiseDocumentSchema.parse(premise);
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('story_premise_drafts')
    .update({ premise: toJson(parsed) })
    .eq('id', draftId)
    .select(DRAFT_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to save premise: ${error.message}`);
  }

  if (data === null) {
    throw new PremiseDraftNotFoundError(draftId);
  }

  return toPremiseDraft(data);
}

/** Store the owner's freeform feedback for the next regeneration. */
export async function savePremiseNotes(
  draftId: string,
  ownerId: string,
  notes: string,
): Promise<PremiseDraft> {
  await getPremiseDraft(draftId, ownerId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('story_premise_drafts')
    .update({ notes: notes.trim() })
    .eq('id', draftId)
    .select(DRAFT_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to save notes: ${error.message}`);
  }

  if (data === null) {
    throw new PremiseDraftNotFoundError(draftId);
  }

  return toPremiseDraft(data);
}

/**
 * Record that this draft produced a story. The draft is retained rather than
 * deleted (design.md), so "how was this story created?" stays answerable.
 */
export async function markPremiseDraftApproved(
  draftId: string,
  ownerId: string,
  storyId: string,
): Promise<void> {
  await getPremiseDraft(draftId, ownerId);

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('story_premise_drafts')
    .update({ status: 'approved', story_id: storyId })
    .eq('id', draftId);

  if (error !== null) {
    throw new Error(`Failed to mark premise draft approved: ${error.message}`);
  }
}
