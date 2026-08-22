import 'server-only';

import { getUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { parseAppearancePrefs, type AppearancePrefs } from '@/lib/appearance/types';

/**
 * Uses getUser(), not requireUser() — the root layout renders on public
 * routes (/, /sign-in) and must not redirect signed-out visitors.
 */
export async function getServerAppearancePrefs(): Promise<AppearancePrefs | null> {
  const user = await getUser();
  if (user === null) {
    return null;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from('user_preferences')
    .select('theme_preset, accent_hue, font_pairing, text_scale')
    .eq('user_id', user.id)
    .maybeSingle();

  if (data === null) {
    return null;
  }

  return parseAppearancePrefs({
    themePreset: data.theme_preset,
    accentHue: data.accent_hue,
    fontPairing: data.font_pairing,
    textScale: data.text_scale,
  });
}
