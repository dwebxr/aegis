import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0a0f1e",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL("https://aegis.dwebxr.xyz"),

  title: {
    default: "Aegis — AI Content Quality Filter",
    template: "%s | Aegis",
  },

  description:
    "Zero-noise briefing powered by AI + Nostr + Internet Computer. Filter slop, curate quality, exchange signals with other agents.",

  manifest: "/manifest.json",

  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Aegis",
  },

  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },

  openGraph: {
    type: "website",
    siteName: "Aegis",
    title: "Aegis — AI Content Quality Filter",
    description:
      "Your personal AI that burns the slop and delivers only what matters. Powered by on-chain AI scoring, Nostr signal publishing, and device-to-agent content exchange.",
    url: "https://aegis.dwebxr.xyz",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Aegis — AI Content Quality Filter",
        type: "image/png",
      },
    ],
    locale: "en_US",
  },

  twitter: {
    card: "summary_large_image",
    title: "Aegis — AI Content Quality Filter",
    description:
      "Zero-noise briefing. AI scores content, burns the slop, delivers quality. Built on Nostr + Internet Computer.",
    images: ["/og-image.png"],
  },

  keywords: [
    "AI",
    "content curation",
    "Nostr",
    "Internet Computer",
    "ICP",
    "briefing",
    "slop detection",
    "content quality",
    "D2A",
    "decentralized",
  ],

  authors: [{ name: "DWEBXR LAB", url: "https://dwebxr.xyz" }],

  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Aegis",
  description:
    "AI Content Quality Filter — Zero-noise briefing powered by AI + Nostr + Internet Computer",
  url: "https://aegis.dwebxr.xyz",
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: {
    "@type": "Organization",
    name: "DWEBXR LAB",
    url: "https://dwebxr.xyz",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
