import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { clientEnv } from '@/lib/env';

/**
 * Session refresh.
 *
 * Named `proxy` rather than `middleware`: the middleware convention is
 * deprecated in Next.js 16 and renamed to proxy. Same functionality.
 *
 * This refreshes the auth token and rewrites the cookies onto the response.
 * Route-level authorization still happens in each route via requireUser() —
 * this only keeps sessions from expiring mid-visit.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Revalidates the token and triggers the cookie rewrite above. Do not remove:
  // without it, sessions silently expire.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Without a matcher this runs on every request including static assets,
  // which would block CSS and images behind auth logic.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
