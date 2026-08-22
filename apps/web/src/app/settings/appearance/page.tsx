import { requireUser } from '@/lib/auth';
import { getServerAppearancePrefs } from '@/lib/appearance/get-preferences';
import { DEFAULT_APPEARANCE } from '@/lib/appearance/types';
import { AppearancePanel } from '@/app/settings/appearance/appearance-panel';

export default async function AppearanceSettingsPage() {
  await requireUser();
  const prefs = (await getServerAppearancePrefs()) ?? DEFAULT_APPEARANCE;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold sm:text-2xl">Appearance</h1>
        <p className="text-sm text-muted-foreground">
          Choose a theme, an accent color, a font pairing, and a text size. Changes apply
          instantly and follow you across devices.
        </p>
      </div>
      <AppearancePanel initialPrefs={prefs} />
    </main>
  );
}
