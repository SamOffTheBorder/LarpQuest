'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Reading and writing the spend caps a user controls.
 *
 * Writes go through the request-scoped client, not the service role, so RLS
 * decides who may set a story's cap. The story policies already restrict
 * updates to the owner and GM, which is exactly who should hold the purse.
 */

/** An empty field means "no cap of my own" and stores null, not zero. */
const capSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .pipe(
    z.union([
      z.null(),
      z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount in dollars, for example 25 or 25.00')
        .transform(Number)
        .pipe(z.number().min(0).max(100_000)),
    ]),
  );

export interface SpendCapFormState {
  status: 'idle' | 'saved' | 'error';
  message?: string;
}

export async function saveUserSpendCapAction(
  _previous: SpendCapFormState,
  formData: FormData,
): Promise<SpendCapFormState> {
  const user = await requireUser();

  const parsed = capSchema.safeParse(formData.get('cap') ?? '');
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid amount.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: user.id, spend_cap_usd: parsed.data }, { onConflict: 'user_id' });

  if (error !== null) {
    return { status: 'error', message: 'Could not save the cap. Try again.' };
  }

  revalidatePath('/settings/spending');
  return { status: 'saved' };
}

export async function saveStorySpendCapAction(
  _previous: SpendCapFormState,
  formData: FormData,
): Promise<SpendCapFormState> {
  await requireUser();

  const storyId = String(formData.get('storyId') ?? '');
  if (storyId === '') {
    return { status: 'error', message: 'Missing story.' };
  }

  const parsed = capSchema.safeParse(formData.get('cap') ?? '');
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid amount.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('stories')
    .update({ spend_cap_usd: parsed.data })
    .eq('id', storyId);

  if (error !== null) {
    return { status: 'error', message: 'Could not save the cap. Try again.' };
  }

  revalidatePath(`/stories/${storyId}`);
  return { status: 'saved' };
}
