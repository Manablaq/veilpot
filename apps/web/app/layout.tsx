import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter_Tight, Manrope } from "next/font/google";
import type { ReactNode } from "react";

import { AppProviders } from "@/components/app-providers";

import "./globals.css";
import "../styles/meridian/tokens.css";
import "../styles/meridian/base.css";
import "../styles/meridian/primitives.css";
import "../styles/meridian/cipher.css";
import "../styles/meridian/motion.css";

const displayFont = Inter_Tight({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

const interfaceFont = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-interface",
  display: "swap",
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Veilpot — Private prize savings",
    template: "%s · Veilpot",
  },
  description:
    "Confidential prize savings with private positions, bounded Autopilot saving, VeilDraw, and explicit reveal controls.",
  applicationName: "Veilpot",
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0B1020" },
    { media: "(prefers-color-scheme: light)", color: "#F4F3F0" },
  ],
};

const themeBootstrap = `(() => {
  try {
    const stored = localStorage.getItem('veilpot-theme');
    const mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
    const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.style.colorScheme = theme;
  } catch {}
})();`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className={`${displayFont.variable} ${interfaceFont.variable} ${monoFont.variable}`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
