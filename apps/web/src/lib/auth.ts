import 'server-only';

import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

/**
 * Session enforcement.
 *
 * The acting user is derived only from the server-side session. A user id in a
 * request body, query string, or header is ignored — it is an assertion by the
 * caller, not evidence.
 */

/**
 * Resolve the current user, or redirect to sign-in.
 *
 * Call this before any database work in a protected route. Uses `getUser()`
 * rather than `getSession()`: getUser revalidates the token with the auth
 * server, while getSession trusts a cookie that a client could have forged.
 */
export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error !== null || data.user === null) {
    redirect('/sign-in');
  }

  return data.user;
}

/** Resolve the current user, or null. For routes that render differently when signed out. */
export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error !== null) {
    return null;
  }

  return data.user;
}

/**
 * API-route variant. Returns null instead of redirecting, so the handler can
 * respond 401 — a redirect is meaningless to a fetch caller.
 */
export async function requireUserForApi(): Promise<User | null> {
  return getUser();
}
