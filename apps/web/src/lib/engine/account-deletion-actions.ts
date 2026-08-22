'use server';

import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { AccountDeletionBlockedError, deleteAccount } from '@/lib/engine/account-deletion';
import { createClient } from '@/lib/supabase/server';

export interface DeleteAccountState {
  status: 'idle' | 'error';
  message?: string;
  blockedStories?: { storyId: string; title: string }[];
}

const INITIAL: DeleteAccountState = { status: 'idle' };

/**
 * A confirmation phrase, not a password re-prompt: this is a destructive,
 * irreversible action reachable from a settings page the user is already
 * authenticated into, and typing the story-losing consequence back is enough
 * friction to catch a misclick without demanding credentials the session
 * already vouches for.
 */
export async function deleteAccountAction(
  _previous: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const user = await requireUser();

  if (formData.get('confirm') !== 'delete my account') {
    return { status: 'error', message: 'Type the confirmation phrase exactly to proceed.' };
  }

  try {
    await deleteAccount(user.id);
  } catch (error) {
    if (error instanceof AccountDeletionBlockedError) {
      return { status: 'error', message: error.message, blockedStories: error.stories };
    }
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not delete the account.',
    };
  }

  // The account no longer exists, so its session is dead regardless — sign
  // out explicitly to clear the client-side cookie rather than leaving a
  // stale session that will fail on its next use.
  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect('/sign-in');
}
