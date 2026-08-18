import 'server-only';

import { createUniverse, type UniverseVersion } from '@/lib/engine/universes';
import { getDraft } from '@/lib/research/drafts';
import type { DraftDocument, DraftSectionKey } from '@/lib/research/draft';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Draft → universe version publishing.
 *
 * This module produces a `UniverseVersionInput` and hands it to the existing
 * Phase 2 `createUniverse` unchanged (proposal.md, "Publish action") — it
 * does not write a universe or universe_versions row itself, and it does not
 * touch immutability or pinning semantics, both of which Phase 2 already
 * owns.
 */

export class DraftIncompleteError extends Error {
  constructor(
    readonly draftId: string,
    readonly missingSection: DraftSectionKey,
  ) {
    super(`Draft ${draftId} cannot be published: section "${missingSection}" is not accepted.`);
    this.name = 'DraftIncompleteError';
  }
}

/**
 * A section counts as ready to publish once the owner has accepted or edited
 * it — `pending` (never reviewed) and `rejected` both block publish, since a
 * rejected section is a section the owner explicitly said not to use.
 */
function isSectionReady(document: DraftDocument, key: DraftSectionKey): boolean {
  const section = document[key];
  return section !== undefined && (section.status === 'accepted' || section.status === 'edited');
}

/**
 * A universe version needs an entity schema and a progression model — both
 * come from the Schema Derivation section, so it is the one section that is
 * strictly required. Every other section (rules, entities, timeline, rule
 * pack) informs the Canon Bible a story reads later, not the version object
 * itself, so publishing does not block on them here.
 */
export function draftToUniverseVersionInput(draftId: string, name: string, document: DraftDocument) {
  if (!isSectionReady(document, 'schemaDerivation')) {
    throw new DraftIncompleteError(draftId, 'schemaDerivation');
  }

  const section = document.schemaDerivation;
  if (section === undefined) {
    throw new DraftIncompleteError(draftId, 'schemaDerivation');
  }

  const schemaDerivation = section.status === 'edited' ? (section.editedContent ?? section.content) : section.content;

  return {
    name,
    entitySchema: schemaDerivation.entity_schema,
    progressionModel: schemaDerivation.progression_model,
    progressionConfig: schemaDerivation.progression_config,
  };
}

export interface PublishResult {
  universeVersion: UniverseVersion;
}

/**
 * Publish an accepted draft. On success, the draft row is updated to record
 * the outcome (`status: 'published'`, `universe_id`, `published_version`) —
 * it is never deleted (universe-review spec, "Published draft records its
 * outcome").
 */
export async function publishDraft(draftId: string, ownerId: string): Promise<PublishResult> {
  const draft = await getDraft(draftId, ownerId);
  const input = draftToUniverseVersionInput(draftId, draft.input.name, draft.draft);

  const universeVersion = await createUniverse(ownerId, input);

  const supabase = createServiceRoleClient();
  await supabase
    .from('universe_drafts')
    .update({
      status: 'published',
      universe_id: universeVersion.universeId,
      published_version: universeVersion.version,
    })
    .eq('id', draftId);

  return { universeVersion };
}
