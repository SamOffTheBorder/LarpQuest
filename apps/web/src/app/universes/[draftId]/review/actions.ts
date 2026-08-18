'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { rerunStage } from '@/lib/research/drafts';
import { DraftIncompleteError, publishDraft } from '@/lib/research/publish';
import { acceptSection, addHouseRule, editSection, markFactAsAu, rejectSection } from '@/lib/research/review';
import type { DraftSectionKey } from '@/lib/research/draft';
import type { ResearchStage } from '@/lib/research/schemas';

export type ReviewActionState = {
  status: 'idle' | 'error';
  message?: string;
  publishedUniverseId?: string;
};

const initialIdle: ReviewActionState = { status: 'idle' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export async function acceptSectionAction(draftId: string, section: DraftSectionKey): Promise<void> {
  const user = await requireUser();
  await acceptSection(draftId, user.id, section);
  revalidatePath(`/universes/${draftId}/review`);
}

export async function rejectSectionAction(draftId: string, section: DraftSectionKey): Promise<void> {
  const user = await requireUser();
  await rejectSection(draftId, user.id, section);
  revalidatePath(`/universes/${draftId}/review`);
}

export async function editSectionAction(
  draftId: string,
  section: DraftSectionKey,
  editedContent: unknown,
): Promise<void> {
  const user = await requireUser();
  await editSection(draftId, user.id, section, editedContent);
  revalidatePath(`/universes/${draftId}/review`);
}

export async function addHouseRuleAction(
  draftId: string,
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const user = await requireUser();
  const ruleText = formData.get('ruleText');

  if (typeof ruleText !== 'string' || ruleText.trim().length === 0) {
    return { status: 'error', message: 'Rule text is required.' };
  }

  try {
    await addHouseRule(draftId, user.id, ruleText);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/universes/${draftId}/review`);
  return initialIdle;
}

export async function markFactAsAuAction(
  draftId: string,
  section: DraftSectionKey,
  path: string,
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const user = await requireUser();
  const divergenceNote = formData.get('divergenceNote');

  if (typeof divergenceNote !== 'string' || divergenceNote.trim().length === 0) {
    return { status: 'error', message: 'A divergence note is required.' };
  }

  try {
    await markFactAsAu(draftId, user.id, section, path, divergenceNote);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/universes/${draftId}/review`);
  return initialIdle;
}

export async function rerunStageAction(draftId: string, stage: ResearchStage): Promise<void> {
  const user = await requireUser();
  await rerunStage(draftId, user.id, stage);
  revalidatePath(`/universes/${draftId}/review`);
}

export async function publishDraftAction(
  draftId: string,
  _prevState: ReviewActionState,
  _formData: FormData,
): Promise<ReviewActionState> {
  const user = await requireUser();

  try {
    const result = await publishDraft(draftId, user.id);
    revalidatePath(`/universes/${draftId}/review`);
    return {
      status: 'idle',
      message: 'Universe published.',
      publishedUniverseId: result.universeVersion.universeId,
    };
  } catch (error) {
    if (error instanceof DraftIncompleteError) {
      return { status: 'error', message: error.message };
    }
    return { status: 'error', message: errorMessage(error) };
  }
}
