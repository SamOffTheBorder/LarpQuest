import 'server-only';

import { getDraft } from '@/lib/research/drafts';
import type { AuMark, DraftDocument, DraftSectionKey } from '@/lib/research/draft';
import { draftDocumentSchema } from '@/lib/research/draft';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * Review actions over a draft document (universe-review spec).
 *
 * Every action here re-reads the draft through `getDraft` first, which is
 * ownership-checked — a non-owner cannot accept, edit, reject, add a house
 * rule, or mark a fact as AU on someone else's draft, same "not found"
 * shape as every other read in this module.
 */

async function loadDraftDocument(draftId: string, ownerId: string): Promise<DraftDocument> {
  const draft = await getDraft(draftId, ownerId);
  return draft.draft;
}

async function saveDraftDocument(draftId: string, document: DraftDocument): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.from('universe_drafts').update({ draft: toJson(document) }).eq('id', draftId);
}

function requireSection(document: DraftDocument, key: DraftSectionKey) {
  const section = document[key];
  if (section === undefined) {
    throw new Error(`Section "${key}" has no content yet.`);
  }
  return section;
}

/** Accept a section's researched content unchanged. */
export async function acceptSection(
  draftId: string,
  ownerId: string,
  section: DraftSectionKey,
): Promise<void> {
  const document = await loadDraftDocument(draftId, ownerId);
  const current = requireSection(document, section);

  const next = draftDocumentSchema.parse({
    ...document,
    [section]: { ...current, status: 'accepted' },
  });

  await saveDraftDocument(draftId, next);
}

/**
 * Replace a section's content with the owner's edit. The edit is attributed
 * to the user (status `edited`, distinct from `accepted`) rather than
 * presented as researched output (universe-review spec, "Edit a fact before
 * accepting").
 */
export async function editSection(
  draftId: string,
  ownerId: string,
  section: DraftSectionKey,
  editedContent: unknown,
): Promise<void> {
  const document = await loadDraftDocument(draftId, ownerId);
  const current = requireSection(document, section);

  const next = draftDocumentSchema.parse({
    ...document,
    [section]: { ...current, status: 'edited', editedContent },
  });

  await saveDraftDocument(draftId, next);
}

/**
 * Reject a section. The researched content is kept in place (not deleted) —
 * only its status changes — so a later "undo" or the gaps report can still
 * see what was rejected and why publish is blocked.
 */
export async function rejectSection(
  draftId: string,
  ownerId: string,
  section: DraftSectionKey,
): Promise<void> {
  const document = await loadDraftDocument(draftId, ownerId);
  const current = requireSection(document, section);

  const next = draftDocumentSchema.parse({
    ...document,
    [section]: { ...current, status: 'rejected' },
  });

  await saveDraftDocument(draftId, next);
}

/**
 * Append a freeform house rule, distinct from research-derived rules by
 * `source: 'user'` (universe-review spec, "Add a house rule"). Requires the
 * rule pack section to already exist — Stage 7 always runs, so this is only
 * reachable before Stage 7 completes if a draft is still `researching`.
 */
export async function addHouseRule(draftId: string, ownerId: string, ruleText: string): Promise<void> {
  const trimmed = ruleText.trim();
  if (trimmed.length === 0) {
    throw new Error('House rule text must not be empty.');
  }

  const document = await loadDraftDocument(draftId, ownerId);
  const rulePack = document.rulePack;

  if (rulePack === undefined) {
    throw new Error('Cannot add a house rule before the rule pack stage has produced a section.');
  }

  const content = rulePack.status === 'edited' ? (rulePack.editedContent ?? rulePack.content) : rulePack.content;

  const nextContent = {
    rules: [
      ...content.rules,
      {
        id: `user-${crypto.randomUUID()}`,
        source: 'user' as const,
        check: trimmed,
        severity: 'warn' as const,
      },
    ],
  };

  const next = draftDocumentSchema.parse({
    ...document,
    rulePack: { ...rulePack, status: 'edited', editedContent: nextContent },
  });

  await saveDraftDocument(draftId, next);
}

/**
 * Mark a single fact as an AU divergence. The original researched value is
 * untouched — the mark is recorded alongside it, not over it (universe-review
 * spec, "Mark a fact as AU": "the fact retains its original researched
 * value").
 */
export async function markFactAsAu(
  draftId: string,
  ownerId: string,
  section: DraftSectionKey,
  path: string,
  divergenceNote: string,
): Promise<void> {
  const trimmedNote = divergenceNote.trim();
  if (trimmedNote.length === 0) {
    throw new Error('A divergence note is required to mark a fact as AU.');
  }

  const document = await loadDraftDocument(draftId, ownerId);
  requireSection(document, section);

  const mark: AuMark = { section, path, divergenceNote: trimmedNote };
  const withoutExisting = document.auMarks.filter((m) => !(m.section === section && m.path === path));

  const next = draftDocumentSchema.parse({
    ...document,
    auMarks: [...withoutExisting, mark],
  });

  await saveDraftDocument(draftId, next);
}
