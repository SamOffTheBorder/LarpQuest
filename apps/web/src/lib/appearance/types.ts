export type ThemePreset = 'dark-arcane' | 'parchment' | 'midnight';
export type FontPairing = 'cinzel-spectral' | 'cormorant-garamond' | 'marcellus-crimson-pro';
export type AccentHue = 300 | 155 | 25 | 85 | 235;
export type TextScaleStep = 0 | 1 | 2 | 3 | 4;

export interface AppearancePrefs {
  themePreset: ThemePreset;
  accentHue: AccentHue;
  fontPairing: FontPairing;
  textScale: TextScaleStep;
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  themePreset: 'dark-arcane',
  accentHue: 300,
  fontPairing: 'cinzel-spectral',
  textScale: 2,
};

export const THEME_PRESETS: readonly ThemePreset[] = ['dark-arcane', 'parchment', 'midnight'];
export const FONT_PAIRINGS: readonly FontPairing[] = [
  'cinzel-spectral',
  'cormorant-garamond',
  'marcellus-crimson-pro',
];
export const ACCENT_HUES: readonly AccentHue[] = [300, 155, 25, 85, 235];
export const TEXT_SCALE_STEPS: readonly TextScaleStep[] = [0, 1, 2, 3, 4];

function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && (THEME_PRESETS as readonly string[]).includes(value);
}

function isFontPairing(value: unknown): value is FontPairing {
  return typeof value === 'string' && (FONT_PAIRINGS as readonly string[]).includes(value);
}

function isAccentHue(value: unknown): value is AccentHue {
  return typeof value === 'number' && (ACCENT_HUES as readonly number[]).includes(value);
}

function isTextScaleStep(value: unknown): value is TextScaleStep {
  return typeof value === 'number' && (TEXT_SCALE_STEPS as readonly number[]).includes(value);
}

/** Validates an arbitrary object into AppearancePrefs, or returns null if malformed. */
export function parseAppearancePrefs(value: unknown): AppearancePrefs | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (
    !isThemePreset(candidate.themePreset) ||
    !isAccentHue(candidate.accentHue) ||
    !isFontPairing(candidate.fontPairing) ||
    !isTextScaleStep(candidate.textScale)
  ) {
    return null;
  }

  return {
    themePreset: candidate.themePreset,
    accentHue: candidate.accentHue,
    fontPairing: candidate.fontPairing,
    textScale: candidate.textScale,
  };
}
