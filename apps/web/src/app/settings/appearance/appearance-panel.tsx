'use client';

import { CheckIcon } from 'lucide-react';

import { useAppearance } from '@/components/appearance/appearance-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AccentHue, AppearancePrefs, FontPairing, TextScaleStep, ThemePreset } from '@/lib/appearance/types';

const THEME_OPTIONS: { key: ThemePreset; name: string; previewClass: string }[] = [
  { key: 'dark-arcane', name: 'Dark Arcane', previewClass: 'bg-[oklch(0.2_0.02_290)]' },
  { key: 'parchment', name: 'Parchment', previewClass: 'bg-[oklch(0.94_0.015_85)]' },
  { key: 'midnight', name: 'Midnight', previewClass: 'bg-[oklch(0.14_0.02_265)]' },
];

const ACCENT_OPTIONS: { hue: AccentHue; name: string }[] = [
  { hue: 300, name: 'Violet' },
  { hue: 155, name: 'Emerald' },
  { hue: 25, name: 'Crimson' },
  { hue: 85, name: 'Gold' },
  { hue: 235, name: 'Azure' },
];

const FONT_OPTIONS: { key: FontPairing; name: string; sample: string; displayClass: string; bodyClass: string }[] = [
  {
    key: 'cinzel-spectral',
    name: 'Cinzel + Spectral',
    sample: 'Ornate display, readable serif body',
    displayClass: 'font-[family-name:var(--font-cinzel)]',
    bodyClass: 'font-[family-name:var(--font-spectral)]',
  },
  {
    key: 'cormorant-garamond',
    name: 'Cormorant + EB Garamond',
    sample: 'Elegant, old-world manuscript feel',
    displayClass: 'font-[family-name:var(--font-cormorant)]',
    bodyClass: 'font-[family-name:var(--font-eb-garamond)]',
  },
  {
    key: 'marcellus-crimson-pro',
    name: 'Marcellus + Crimson Pro',
    sample: 'Cleaner, more contemporary serif pairing',
    displayClass: 'font-[family-name:var(--font-marcellus)]',
    bodyClass: 'font-[family-name:var(--font-crimson-pro)]',
  },
];

const TEXT_SCALE_OPTIONS: { step: TextScaleStep; label: string }[] = [
  { step: 0, label: '12px' },
  { step: 1, label: '13px' },
  { step: 2, label: '14px' },
  { step: 3, label: '16px' },
  { step: 4, label: '18px' },
];

export function AppearancePanel({ initialPrefs }: { initialPrefs: AppearancePrefs }) {
  const { prefs, setPrefs } = useAppearance();
  const active = prefs ?? initialPrefs;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Theme</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme.key}
                type="button"
                onClick={() => setPrefs({ themePreset: theme.key })}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border-2 p-3 text-left transition-colors',
                  active.themePreset === theme.key ? 'border-primary' : 'border-border',
                )}
              >
                <div className={cn('h-11 w-full rounded-md', theme.previewClass)} />
                <span className="text-xs font-medium">{theme.name}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accent color</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {ACCENT_OPTIONS.map((accent) => (
              <button
                key={accent.hue}
                type="button"
                onClick={() => setPrefs({ accentHue: accent.hue })}
                className="flex flex-col items-center gap-1.5"
                aria-label={accent.name}
              >
                <span
                  className="flex size-9 items-center justify-center rounded-full"
                  style={{
                    background: `oklch(0.6 0.14 ${accent.hue})`,
                    boxShadow:
                      active.accentHue === accent.hue
                        ? '0 0 0 2px var(--background), 0 0 0 4px currentColor'
                        : 'none',
                    color: `oklch(0.6 0.14 ${accent.hue})`,
                  }}
                >
                  {active.accentHue === accent.hue && <CheckIcon className="size-4 text-white" />}
                </span>
                <span className="text-xs text-muted-foreground">{accent.name}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Font</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {FONT_OPTIONS.map((font) => (
              <button
                key={font.key}
                type="button"
                onClick={() => setPrefs({ fontPairing: font.key })}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors',
                  active.fontPairing === font.key ? 'border-primary' : 'border-border',
                )}
              >
                <div>
                  <div className={cn('text-lg', font.displayClass)}>{font.name}</div>
                  <div className={cn('mt-1 text-sm text-muted-foreground', font.bodyClass)}>{font.sample}</div>
                </div>
                {active.fontPairing === font.key && <CheckIcon className="size-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Text size</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
            <span className="text-xs text-muted-foreground">A</span>
            <div className="flex flex-1 gap-1.5">
              {TEXT_SCALE_OPTIONS.map((option) => (
                <button
                  key={option.step}
                  type="button"
                  aria-label={option.label}
                  onClick={() => setPrefs({ textScale: option.step })}
                  className={cn(
                    'h-2 flex-1 rounded-full',
                    option.step <= active.textScale ? 'bg-primary' : 'bg-border',
                  )}
                />
              ))}
            </div>
            <span className="text-lg text-muted-foreground">A</span>
          </div>
          <p className="font-serif leading-relaxed text-foreground">
            The gates of Aldermere stand open for the first time in a decade. Snow drifts across
            the threshold as the council waits for an answer.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
