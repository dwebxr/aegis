import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Providers } from "@/components/Providers";
import { APP_URL } from "@/lib/config";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0a0f1e",
  width: "device-width",
  initialScale: 1,
};

const TITLE = "Aegis — AI Content Quality Filter & Zero-Noise Briefing";
const DESC =
  "Open-source AI feed reader that scores every RSS and social post, filters out the slop, and delivers a clean, ranked briefing. Built on the Internet Computer and Nostr.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),

  title: {
    default: TITLE,
    template: "%s | Aegis",
  },

  description: DESC,

  alternates: { canonical: "/" },

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
    title: TITLE,
    description: DESC,
    url: APP_URL,
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
    title: TITLE,
    description: DESC,
    site: "@Coo_aiagent",
    creator: "@Coo_aiagent",
    images: ["/og-image.png"],
  },

  keywords: [
    "AI feed reader",
    "RSS reader",
    "AI news aggregator",
    "content curation",
    "daily briefing",
    "slop detection",
    "content quality",
    "AI curation",
    "Nostr",
    "Internet Computer",
    "ICP",
    "D2A",
    "decentralized",
    "open source",
  ],

  authors: [{ name: "DWEBXR LAB", url: "https://dwebxr.xyz" }],

  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${APP_URL}/#org`,
      name: "DWEBXR LAB",
      url: "https://dwebxr.xyz",
      sameAs: [
        "https://github.com/dwebxr/aegis",
        "https://x.com/Coo_aiagent",
        "https://medium.com/aegis-ai",
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${APP_URL}/#website`,
      name: "Aegis",
      url: APP_URL,
      publisher: { "@id": `${APP_URL}/#org` },
    },
    {
      "@type": "WebApplication",
      "@id": `${APP_URL}/#app`,
      name: "Aegis",
      description: DESC,
      url: APP_URL,
      applicationCategory: "NewsApplication",
      operatingSystem: "Web",
      softwareVersion: "3.0",
      isAccessibleForFree: true,
      screenshot: `${APP_URL}/images/home-dashboard.png`,
      featureList: [
        "AI quality scoring (Value / Context / Legitimacy) for every post",
        "RSS, Nostr, and web page ingestion",
        "Ranked zero-noise daily briefing",
        "Local-first AI cascade: Ollama, in-browser WebLLM, Claude API, Internet Computer LLM",
        "Automatic translation of feed content",
        "Encrypted agent-to-agent content exchange (D2A) over Nostr",
        "Paid machine-readable briefing API via x402 (USDC and JPYC)",
      ],
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      author: { "@id": `${APP_URL}/#org` },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: `try{document.documentElement.setAttribute('data-theme',localStorage.getItem('aegis-theme')==='light'?'light':'dark');if(localStorage.getItem('aegis-auth-hint')==='1')document.documentElement.setAttribute('data-auth-hint','1')}catch(e){console.debug('[theme]',e)}` }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
        {process.env.NODE_ENV === "production" && <Analytics />}
        {process.env.NODE_ENV === "production" && <SpeedInsights sampleRate={0.3} />}
      </body>
    </html>
  );
}
