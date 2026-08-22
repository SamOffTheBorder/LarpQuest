import { parseAppearancePrefs, type AppearancePrefs } from '@/lib/appearance/types';

/**
 * Plain first-party cookie, not tied to Supabase auth. Lets the root layout
 * (a Server Component) resolve the right theme before first paint even for
 * signed-out visitors or before the DB round trip lands, avoiding a
 * flash-of-wrong-theme without a blocking client script.
 */
export const APPEARANCE_COOKIE_NAME = 'sf-appearance';
export const APPEARANCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseAppearanceCookie(raw: string | undefined): AppearancePrefs | null {
  if (raw === undefined) {
    return null;
  }

  try {
    return parseAppearancePrefs(JSON.parse(decodeURIComponent(raw)));
  } catch {
    return null;
  }
}

export function serializeAppearanceCookie(prefs: AppearancePrefs): string {
  const value = encodeURIComponent(JSON.stringify(prefs));
  return `${APPEARANCE_COOKIE_NAME}=${value}; Path=/; Max-Age=${APPEARANCE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
