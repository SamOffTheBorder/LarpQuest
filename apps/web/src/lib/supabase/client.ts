'use client';

import { createBrowserClient } from '@supabase/ssr';

import { clientEnv } from '@/lib/env';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Browser Supabase client. Uses the anon key, so every query it makes is
 * subject to RLS — which is the point.
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
