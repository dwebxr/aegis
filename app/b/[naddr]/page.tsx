import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { parseBriefingMarkdown } from "@/lib/briefing/serialize";
import type { ParsedBriefing } from "@/lib/briefing/serialize";
import { SharedBriefingView } from "@/components/shared/SharedBriefingView";

export const maxDuration = 30;

interface PageProps {
  params: Promise<{ naddr: string }>;
}

const briefingCache = new Map<string, { data: ParsedBriefing | null; at: number }>();

async function fetchBriefing(naddr: string): Promise<ParsedBriefing | null> {
  const cached = briefingCache.get(naddr);
  if (cached && Date.now() - cached.at < 30_000) return cached.data;

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  try {
    const res = await fetch(`${baseUrl}/api/fetch/briefing?naddr=${encodeURIComponent(naddr)}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      briefingCache.set(naddr, { data: null, at: Date.now() });
      return null;
    }

    const data = await res.json();
    const parsed = parseBriefingMarkdown(data.content, data.tags);
    briefingCache.set(naddr, { data: parsed, at: Date.now() });
    return parsed;
  } catch (err) {
    console.error("[briefing/page] Fetch failed:", err);
    briefingCache.set(naddr, { data: null, at: Date.now() });
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { naddr } = await params;
  const briefing = await fetchBriefing(naddr);

  if (!briefing) {
    return {
      title: "Briefing Not Found | Aegis",
    };
  }

  return {
    title: briefing.title,
    description: briefing.summary || `${briefing.insightCount} insights curated by Aegis AI`,
    openGraph: {
      type: "article",
      title: briefing.title,
      description: briefing.summary || `${briefing.insightCount} insights curated by Aegis AI`,
      siteName: "Aegis",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: briefing.title,
      description: briefing.summary || `${briefing.insightCount} insights curated by Aegis AI`,
      images: ["/og-image.png"],
    },
  };
}

export default async function SharedBriefingPage({ params }: PageProps) {
  const { naddr } = await params;
  const briefing = await fetchBriefing(naddr);

  if (!briefing) {
    notFound();
  }

  return <SharedBriefingView briefing={briefing} naddr={naddr} />;
}
