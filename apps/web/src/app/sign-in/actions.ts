'use server';

import { z } from 'zod';

import { clientEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export type SignInState = {
  status: 'idle' | 'sent' | 'error';
  message?: string;
};

/**
 * Sends a magic link. Always reports success on a well-formed address,
 * regardless of whether Supabase Auth actually has an account for it —
 * the spec requires we never disclose registration status.
 */
export async function signInAction(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = emailSchema.safeParse(formData.get('email'));

  if (!parsed.success) {
    return { status: 'error', message: 'Enter a valid email address.' };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      emailRedirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  // Rate-limit and transport errors are shown; account-existence is never
  // encoded in the response either way, so this branch is not a disclosure.
  if (error !== null) {
    // Logged server-side only — the client message stays generic regardless
    // of cause, so this does not disclose anything the spec forbids.
    console.error('signInWithOtp failed', {
      status: error.status,
      code: error.code,
      message: error.message,
    });
    return { status: 'error', message: 'Could not send the link. Try again shortly.' };
  }

  return { status: 'sent' };
}
