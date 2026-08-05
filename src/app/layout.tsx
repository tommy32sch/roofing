import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/providers/service-worker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Roof Leads CRM",
  description: "Roofing lead generation and management platform",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Roof Leads", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

/** Matches the manifest, so the installed app has no light-mode flash on launch. */
export const viewport = {
  themeColor: "#0a0a0a",
};

/**
 * Render every page per request rather than prerendering it at build time.
 *
 * Required by the nonce-based CSP in src/middleware.ts. The nonce is generated
 * per request, so Next can only stamp it onto its inline hydration scripts
 * while rendering that request. A prerendered document is baked at build time
 * with no nonce at all, and every one of its inline scripts is then blocked —
 * measured as 7 inline scripts, 0 nonced, React never attaching, and a
 * completely blank page.
 *
 * The cost is small here: every page is an authenticated client component that
 * fetches its own data, so the prerendered output was only an empty shell, and
 * middleware already ran per request on all of them.
 */
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
      >
        <ThemeProvider>
          {children}
          <ServiceWorkerRegistrar />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
