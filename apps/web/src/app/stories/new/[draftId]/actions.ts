'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import {
  acceptSection,
  approvePremise,
  editSection,
  generatePremise,
  NothingToRegenerateError,
  regeneratePremise,
  rejectSection,
  setCastMemberKept,
} from '@/lib/engine/premise';
import { savePremiseNotes } from '@/lib/engine/premise-drafts';
import type { PremiseSectionKey } from '@/lib/engine/premise-schema';
import { assertWithinRateLimit, RateLimitExceededError } from '@/lib/rate-limit';

export type PremiseActionState = {
  status: 'idle' | 'error';
  message?: string;
  /** Cast members that could not be seeded — the story was still created. */
  failedCast?: { name: string; reason: string }[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function reviewPath(draftId: string): string {
  return `/stories/new/${draftId}`;
}

export async function acceptSectionAction(
  draftId: string,
  section: PremiseSectionKey,
): Promise<void> {
  const user = await requireUser();
  await acceptSection(draftId, user.id, section);
  revalidatePath(reviewPath(draftId));
}

export async function rejectSectionAction(
  draftId: string,
  section: PremiseSectionKey,
): Promise<void> {
  const user = await requireUser();
  await rejectSection(draftId, user.id, section);
  revalidatePath(reviewPath(draftId));
}

export async function editSectionAction(
  draftId: string,
  section: PremiseSectionKey,
  editedContent: unknown,
): Promise<void> {
  const user = await requireUser();
  await editSection(draftId, user.id, section, editedContent);
  revalidatePath(reviewPath(draftId));
}

export async function setCastMemberKeptAction(
  draftId: string,
  index: number,
  kept: boolean,
): Promise<void> {
  const user = await requireUser();
  await setCastMemberKept(draftId, user.id, index, kept);
  revalidatePath(reviewPath(draftId));
}

export async function saveNotesAction(
  draftId: string,
  _prevState: PremiseActionState,
  formData: FormData,
): Promise<PremiseActionState> {
  const user = await requireUser();
  const notes = formData.get('notes');

  await savePremiseNotes(draftId, user.id, typeof notes === 'string' ? notes : '');
  revalidatePath(reviewPath(draftId));

  return { status: 'idle' };
}

/**
 * Regenerate the unsettled sections, or generate for the first time when an
 * earlier attempt failed and left the draft with no premise.
 */
export async function regenerateAction(
  draftId: string,
  _prevState: PremiseActionState,
): Promise<PremiseActionState> {
  const user = await requireUser();

  try {
    await assertWithinRateLimit('premise_generate', user.id);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }

  try {
    await regeneratePremise(draftId, user.id);
  } catch (error) {
    if (error instanceof NothingToRegenerateError) {
      return { status: 'error', message: error.message };
    }
    // The premise the GM was reviewing is untouched — this is retryable.
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(reviewPath(draftId));
  return { status: 'idle' };
}

/** Retry a first generation that failed, leaving the draft premise-less. */
export async function retryGenerateAction(
  draftId: string,
  _prevState: PremiseActionState,
): Promise<PremiseActionState> {
  const user = await requireUser();

  try {
    await assertWithinRateLimit('premise_generate', user.id);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }

  try {
    await generatePremise(draftId, user.id);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(reviewPath(draftId));
  return { status: 'idle' };
}

/**
 * Approve: create the story, seed its ledger and cast, and go to it.
 *
 * A partial cast failure is *not* an error — the story exists and is usable.
 * It is reported so the GM knows which characters to add by hand, and the
 * redirect still happens.
 */
export async function approveAction(
  draftId: string,
  _prevState: PremiseActionState,
): Promise<PremiseActionState> {
  const user = await requireUser();

  let storyId: string;

  try {
    const result = await approvePremise(draftId, user.id);
    storyId = result.storyId;

    if (result.failedCast.length > 0) {
      // Surface it on the review page rather than dropping the GM into a
      // story with silently missing characters.
      return { status: 'error', failedCast: result.failedCast, message: 'The story was created, but some characters could not be added.' };
    }
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  redirect(`/stories/${storyId}`);
}
