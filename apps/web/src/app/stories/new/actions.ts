'use server';

import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { createStoryInputSchema, createStory } from '@/lib/engine/stories';
import { generatePremise } from '@/lib/engine/premise';
import { createPremiseDraft } from '@/lib/engine/premise-drafts';
import { premiseInputSchema } from '@/lib/engine/premise-schema';
import { assertWithinRateLimit, RateLimitExceededError } from '@/lib/rate-limit';

export type CreateStoryState = {
  status: 'idle' | 'error';
  message?: string;
};

/**
 * The skip path: create a story directly from a title and rating, with no
 * premise generation and no model call. Unchanged from before the premise
 * step existed — a story created this way is indistinguishable from one
 * created by the old form.
 */
export async function createStoryAction(
  _prevState: CreateStoryState,
  formData: FormData,
): Promise<CreateStoryState> {
  const user = await requireUser();

  try {
    await assertWithinRateLimit('story_create', user.id);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }

  const universeId = formData.get('universeId');

  const parsed = createStoryInputSchema.safeParse({
    title: formData.get('title'),
    contentRating: formData.get('contentRating'),
    universeId: typeof universeId === 'string' && universeId.length > 0 ? universeId : null,
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const story = await createStory(user.id, parsed.data);

  redirect(`/stories/${story.id}`);
}

function optionalText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value : '';
}

/**
 * The premise path: persist the GM's intent, then generate.
 *
 * The draft is created *before* the model call so a generation failure never
 * costs the GM their typed intent — they land on the review page with a
 * retryable error rather than an empty form.
 */
export async function generatePremiseAction(
  _prevState: CreateStoryState,
  formData: FormData,
): Promise<CreateStoryState> {
  const user = await requireUser();

  try {
    await assertWithinRateLimit('premise_generate', user.id);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }

  const universeId = formData.get('universeId');

  const parsed = premiseInputSchema.safeParse({
    pitch: optionalText(formData, 'pitch'),
    settingSketch: optionalText(formData, 'settingSketch'),
    toneNotes: optionalText(formData, 'toneNotes'),
    mustInclude: optionalText(formData, 'mustInclude'),
    mustAvoid: optionalText(formData, 'mustAvoid'),
    castSize: optionalText(formData, 'castSize') || 3,
    contentRating: formData.get('contentRating'),
    universeId: typeof universeId === 'string' && universeId.length > 0 ? universeId : null,
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const draft = await createPremiseDraft(user.id, parsed.data);

  try {
    await generatePremise(draft.id, user.id);
  } catch {
    // Swallowed deliberately: the intent is already saved, so the GM lands on
    // the review page with a retry rather than back on an empty form. The
    // page renders the not-yet-generated state when `premise` is null.
  }

  // Outside the try — `redirect` signals by throwing, so calling it inside
  // one risks the catch swallowing the navigation.
  redirect(`/stories/new/${draft.id}`);
}
