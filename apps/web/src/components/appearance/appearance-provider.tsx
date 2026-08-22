'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { persistAppearanceAction } from '@/lib/appearance/actions';
import { serializeAppearanceCookie } from '@/lib/appearance/cookie';
import type { AppearancePrefs } from '@/lib/appearance/types';

interface AppearanceContextValue {
  prefs: AppearancePrefs;
  setPrefs: (patch: Partial<AppearancePrefs>) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function applyToDom(prefs: AppearancePrefs) {
  const html = document.documentElement;
  html.dataset.theme = prefs.themePreset;
  html.dataset.font = prefs.fontPairing;
  html.dataset.textScale = String(prefs.textScale);
  html.style.setProperty('--accent-hue', String(prefs.accentHue));
}

export function AppearanceProvider({
  initialPrefs,
  children,
}: {
  initialPrefs: AppearancePrefs;
  children: ReactNode;
}) {
  const [prefs, setPrefsState] = useState(initialPrefs);

  // The server already rendered <html> with these attributes (layout.tsx),
  // so this only matters if client state and the server-rendered DOM ever
  // diverge (e.g. React re-mounting the tree) — kept for correctness, not to
  // avoid the initial flash, which the server render already prevents.
  useEffect(() => {
    applyToDom(prefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPrefs = useCallback(
    (patch: Partial<AppearancePrefs>) => {
      const next = { ...prefs, ...patch };
      applyToDom(next);
      document.cookie = serializeAppearanceCookie(next);
      void persistAppearanceAction(next);
      setPrefsState(next);
    },
    [prefs],
  );

  return <AppearanceContext.Provider value={{ prefs, setPrefs }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (ctx === null) {
    throw new Error('useAppearance must be used within AppearanceProvider');
  }
  return ctx;
}
