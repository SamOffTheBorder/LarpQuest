import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  Geist,
  Geist_Mono,
  Cinzel,
  Spectral,
  Cormorant_Garamond,
  EB_Garamond,
  Marcellus,
  Crimson_Pro,
} from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AppearanceProvider } from "@/components/appearance/appearance-provider";
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { parseAppearanceCookie, APPEARANCE_COOKIE_NAME } from "@/lib/appearance/cookie";
import { DEFAULT_APPEARANCE } from "@/lib/appearance/types";
import { getServerAppearancePrefs } from "@/lib/appearance/get-preferences";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["500", "600"],
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600"],
});

const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const marcellus = Marcellus({
  variable: "--font-marcellus",
  subsets: ["latin"],
  weight: ["400"],
});

const crimsonPro = Crimson_Pro({
  variable: "--font-crimson-pro",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "StoryForge",
  description: "Collaborative, AI-narrated storytelling across any universe.",
};

// Typed explicitly rather than with Next's generated `LayoutProps<"/">`
// global: that type lives in `.next/types`, which exists only after a build,
// so depending on it makes `tsc --noEmit` pass locally (where a build has run)
// and fail in CI, where typecheck runs first against a clean checkout.
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const cookiePrefs = parseAppearanceCookie(cookieStore.get(APPEARANCE_COOKIE_NAME)?.value);
  const dbPrefs = await getServerAppearancePrefs();
  const prefs = dbPrefs ?? cookiePrefs ?? DEFAULT_APPEARANCE;

  return (
    <html
      lang="en"
      data-theme={prefs.themePreset}
      data-font={prefs.fontPairing}
      data-text-scale={String(prefs.textScale)}
      style={{ "--accent-hue": prefs.accentHue } as React.CSSProperties}
      className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} ${spectral.variable} ${cormorant.variable} ${ebGaramond.variable} ${marcellus.variable} ${crimsonPro.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppearanceProvider initialPrefs={prefs}>
          <AppHeader />
          {children}
          <AppFooter />
          <Toaster />
        </AppearanceProvider>
      </body>
    </html>
  );
}
