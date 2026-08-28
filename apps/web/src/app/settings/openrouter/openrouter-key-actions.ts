'use server';

import { revalidatePath } from 'next/cache';

import { deleteUserApiKey, saveUserApiKey } from '@/lib/ai/api-key';
import { requireUser } from '@/lib/auth';

export type OpenRouterKeyActionState = {
  status: 'idle' | 'saved' | 'removed' | 'error';
  message?: string;
};

export async function saveOpenRouterKeyAction(
  _prevState: OpenRouterKeyActionState,
  formData: FormData,
): Promise<OpenRouterKeyActionState> {
  const user = await requireUser();

  const key = formData.get('key');
  if (typeof key !== 'string' || key.trim().length === 0) {
    return { status: 'error', message: 'Enter your OpenRouter API key.' };
  }

  try {
    await saveUserApiKey(user.id, key);
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not save the key.',
    };
  }

  revalidatePath('/settings/openrouter');
  return { status: 'saved', message: 'Key saved.' };
}

export async function removeOpenRouterKeyAction(
  _prevState: OpenRouterKeyActionState,
  _formData: FormData,
): Promise<OpenRouterKeyActionState> {
  const user = await requireUser();

  try {
    await deleteUserApiKey(user.id);
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not remove the key.',
    };
  }

  revalidatePath('/settings/openrouter');
  return { status: 'removed', message: 'Key removed.' };
}
