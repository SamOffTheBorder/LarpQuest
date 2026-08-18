import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { clientEnv, serverEnv } from '@/lib/env';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Server Supabase client, scoped to the caller's session.
 *
 * Uses the anon key, so RLS applies. This is the client almost everything
 * should use — `createServiceRoleClient` is the exception, not the default.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh happens in proxy.ts, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for engine writes that legitimately act outside any one user's
 * permissions — publishing a generated chapter, the extraction worker, writing
 * usage_log. Never expose its results to a caller without checking membership
 * yourself first, since RLS will not do it for you.
 */
export function createServiceRoleClient() {
  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // Service-role calls carry no user session.
        },
      },
    },
  );
}
