import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { decode } from "nostr-tools/nip19";
import type { AddressPointer } from "nostr-tools/nip19";
import { fetchEventByAddress } from "@/lib/nostr/fetch";
import { parseBriefingMarkdown } from "@/lib/briefing/serialize";
import { SharedBriefingView } from "@/components/shared/SharedBriefingView";
import { DEFAULT_RELAYS, KIND_LONG_FORM } from "@/lib/nostr/types";

interface PageProps {
  params: Promise<{ naddr: string }>;
}

function decodeNaddr(naddr: string): AddressPointer | null {
  try {
    const decoded = decode(naddr);
    if (decoded.type !== "naddr") return null;
    const addr = decoded.data as AddressPointer;
    if (addr.kind !== KIND_LONG_FORM) return null;
    return addr;
  } catch {
    return null;
  }
}

async function fetchBriefing(naddr: string) {
  const addr = decodeNaddr(naddr);
  if (!addr) return null;

  const relays =
    addr.relays && addr.relays.length > 0
      ? addr.relays
      : DEFAULT_RELAYS;

  const event = await fetchEventByAddress(addr, relays);
  if (!event) return null;

  const parsed = parseBriefingMarkdown(event.content, event.tags);
  return parsed;
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
