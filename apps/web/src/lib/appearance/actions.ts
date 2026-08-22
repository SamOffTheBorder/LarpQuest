'use server';

import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AppearancePrefs } from '@/lib/appearance/types';

/**
 * Fire-and-forget persistence. The client has already applied the change
 * optimistically (DOM attributes + cookie) before calling this — this exists
 * purely to sync the preference across devices, not to drive a re-render, so
 * it deliberately skips useActionState/revalidatePath.
 */
export async function persistAppearanceAction(prefs: AppearancePrefs): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();

  await supabase.from('user_preferences').upsert(
    {
      user_id: user.id,
      theme_preset: prefs.themePreset,
      accent_hue: prefs.accentHue,
      font_pairing: prefs.fontPairing,
      text_scale: prefs.textScale,
    },
    { onConflict: 'user_id' },
  );
}
