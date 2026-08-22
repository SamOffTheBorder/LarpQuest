'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { setUsername, usernameSchema, UsernameTakenError } from '@/lib/engine/profiles';

export type UsernameActionState = {
  status: 'idle' | 'saved' | 'error';
  message?: string;
};

export async function setUsernameAction(
  _prevState: UsernameActionState,
  formData: FormData,
): Promise<UsernameActionState> {
  const user = await requireUser();

  const parsed = usernameSchema.safeParse(formData.get('username'));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid username.' };
  }

  try {
    await setUsername(user.id, parsed.data);
  } catch (error) {
    if (error instanceof UsernameTakenError) {
      return { status: 'error', message: error.message };
    }

    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Something went wrong.',
    };
  }

  revalidatePath('/settings/account');
  return { status: 'saved', message: 'Username saved.' };
}
