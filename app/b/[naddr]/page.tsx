import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { decode } from "nostr-tools/nip19";
import type { AddressPointer } from "nostr-tools/nip19";
import { parseBriefingMarkdown } from "@/lib/briefing/serialize";
import type { ParsedBriefing } from "@/lib/briefing/serialize";
import { SharedBriefingView } from "@/components/shared/SharedBriefingView";
import { KIND_LONG_FORM, mergeRelays } from "@/lib/nostr/types";
import { withTimeout } from "@/lib/utils/timeout";
import { errMsg } from "@/lib/utils/errors";

export const maxDuration = 30;

interface PageProps {
  params: Promise<{ naddr: string }>;
}

const briefingCache = new Map<string, { data: ParsedBriefing | null; at: number }>();

async function fetchBriefing(naddr: string): Promise<ParsedBriefing | null> {
  const cached = briefingCache.get(naddr);
  if (cached && Date.now() - cached.at < 30_000) return cached.data;

  let addr: AddressPointer;
  try {
    const decoded = decode(naddr);
    if (decoded.type !== "naddr") return null;
    addr = decoded.data as AddressPointer;
    if (addr.kind !== KIND_LONG_FORM) return null;
  } catch {
    return null;
  }

  const relays = mergeRelays(addr.relays);

  const { SimplePool, useWebSocketImplementation: setWsImpl } =
    await import("nostr-tools/pool");
  const WebSocket = (await import("ws")).default;
  setWsImpl(WebSocket as unknown as typeof globalThis.WebSocket);

  const pool = new SimplePool();
  const filter = {
    kinds: [addr.kind],
    authors: [addr.pubkey],
    "#d": [addr.identifier],
    limit: 1,
  };

  try {
    const events = await withTimeout(pool.querySync(relays, filter), 15000);

    if (events.length === 0) {
      briefingCache.set(naddr, { data: null, at: Date.now() });
      return null;
    }

    const event = events[0];
    const parsed = parseBriefingMarkdown(event.content, event.tags);
    briefingCache.set(naddr, { data: parsed, at: Date.now() });
    return parsed;
  } catch (err) {
    const msg = errMsg(err);
    if (msg === "timeout") {
      console.warn("[briefing/page] Relay query timed out for", naddr);
    } else {
      console.error("[briefing/page] Relay query failed:", err);
    }
    briefingCache.set(naddr, { data: null, at: Date.now() });
    return null;
  } finally {
    pool.close(relays);
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

  const desc = briefing.summary || `${briefing.insightCount} insights curated by Aegis AI`;
  return {
    title: briefing.title,
    description: desc,
    openGraph: {
      type: "article",
      title: briefing.title,
      description: desc,
      siteName: "Aegis",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: briefing.title,
      description: desc,
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
