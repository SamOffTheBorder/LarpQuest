import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Magic-link landing point. Supabase redirects here with either `?code=...`
 * (exchange for a session) or `?error=...` (expired/reused link, or the user
 * denied something upstream) — never both.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');

  if (code === null) {
    return NextResponse.redirect(`${origin}/sign-in/link-expired`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error !== null) {
    return NextResponse.redirect(`${origin}/sign-in/link-expired`);
  }

  return NextResponse.redirect(`${origin}/stories`);
}
