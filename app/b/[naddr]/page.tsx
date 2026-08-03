import type { Metadata } from "next";
import { decode } from "nostr-tools/nip19";
import type { AddressPointer } from "nostr-tools/nip19";
import { parseBriefingMarkdown } from "@/lib/briefing/serialize";
import type { ParsedBriefing } from "@/lib/briefing/serialize";
import { SharedBriefingView } from "@/components/shared/SharedBriefingView";
import { BriefingNotFound } from "@/components/shared/BriefingNotFound";
import { KIND_LONG_FORM, mergeRelays } from "@/lib/nostr/types";
import { loadServerPool } from "@/lib/nostr/serverPool";
import { withTimeout } from "@/lib/utils/timeout";
import { errMsg } from "@/lib/utils/errors";

export const maxDuration = 30;
// 5 minutes, not an hour: this window also applies to a "not found" render, and
// a share link opened before the briefing has propagated to the relays would
// otherwise keep showing "not found" long after it arrived.
export const revalidate = 300;

interface PageProps {
  params: Promise<{ naddr: string }>;
}

/**
 * Empty on purpose: nothing is prerendered at build time, but declaring it is
 * what registers this route in the prerender manifest, which is what makes the
 * `revalidate` above real. Without it Next classifies the route as fully dynamic
 * (verified: no dynamicRoutes entry, and responses carried
 * `Cache-Control: private, no-store` with no x-nextjs-cache header), so every
 * request — including repeat crawls of the same link — paid for a full render.
 */
export async function generateStaticParams() {
  return [];
}

const briefingCache = new Map<string, { data: ParsedBriefing | null; at: number }>();

/**
 * bech32 with the naddr HRP. Checked before anything else because the work
 * behind this route is a 15-second relay query over WebSockets: a crawler
 * walking junk paths must be rejected by a regex, not by a relay round trip.
 */
const NADDR_PATTERN = /^naddr1[023456789acdefghjklmnpqrstuvwxyz]{20,}$/;

async function fetchBriefing(naddr: string): Promise<ParsedBriefing | null> {
  if (!NADDR_PATTERN.test(naddr)) return null;

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

  const pool = await loadServerPool();
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
      console.error("[briefing/page] Relay query failed:", errMsg(err));
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
      alternates: { canonical: `/b/${naddr}` },
      // The page answers 200 so it can be cached; noindex is what keeps a
      // missing briefing out of search results.
      robots: { index: false, follow: false },
    };
  }

  const desc = briefing.summary || `${briefing.insightCount} insights curated by Aegis AI`;
  return {
    title: briefing.title,
    description: desc,
    alternates: { canonical: `/b/${naddr}` },
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
    // Not notFound(): Next never stores a 404 in the route cache, so every crawl
    // of a dead link re-rendered on the server. At 200 this render joins the ISR
    // cache (verified: x-nextjs-cache MISS then HIT) and repeats are free.
    // generateMetadata marks it noindex so it stays out of search results.
    return <BriefingNotFound naddr={naddr} />;
  }

  return <SharedBriefingView briefing={briefing} naddr={naddr} />;
}
