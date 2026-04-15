import { Feed } from "feed";
import type { D2ABriefingResponse, D2ABriefingItem } from "@/lib/d2a/types";
import { APP_URL } from "@/lib/config";

const AEGIS_NS = "https://aegis-ai.xyz/ns/feed";
const SUMMARY_MAX_CHARS = 600;

function summarize(item: D2ABriefingItem): string {
  const text = item.content.length > SUMMARY_MAX_CHARS
    ? item.content.slice(0, SUMMARY_MAX_CHARS).trimEnd() + "…"
    : item.content;
  return `[score ${item.scores.composite.toFixed(1)}] ${text}`;
}

function feedItemId(item: D2ABriefingItem, fallbackIndex: number, principal: string): string {
  if (item.sourceUrl) return item.sourceUrl;
  // Stable URN for items lacking a sourceUrl (e.g. raw nostr events without external link).
  return `urn:aegis:item:${principal}:${fallbackIndex}:${encodeURIComponent(item.title.slice(0, 80))}`;
}

export interface BuildFeedOptions {
  briefing: D2ABriefingResponse;
  principal: string;
  /** Absolute URL of the RSS endpoint (used for self-link metadata). */
  rssSelfUrl: string;
  /** Absolute URL of the Atom endpoint (used for self-link metadata). */
  atomSelfUrl: string;
}

export function buildFeed({ briefing, principal, rssSelfUrl, atomSelfUrl }: BuildFeedOptions): Feed {
  const updated = new Date(briefing.generatedAt);
  const feed = new Feed({
    title: `Aegis briefing — ${principal.slice(0, 8)}…`,
    description: `AI-curated content briefing produced by Aegis (V/C/L scoring). Items rated ${briefing.summary.qualityRate.toFixed(0)}% quality from ${briefing.summary.totalEvaluated} evaluated.`,
    id: `urn:aegis:briefing:${principal}`,
    link: APP_URL,
    language: "en",
    updated,
    generator: "Aegis",
    feedLinks: { rss: rssSelfUrl, atom: atomSelfUrl },
    copyright: `Curated by Aegis user ${principal}.`,
  });

  // Add primary topics as feed-level categories.
  for (const topic of briefing.meta.topics.slice(0, 20)) {
    feed.addCategory(topic);
  }

  briefing.items.forEach((item, index) => {
    feed.addItem({
      title: item.title,
      id: feedItemId(item, index, principal),
      link: item.sourceUrl || APP_URL,
      description: summarize(item),
      content: item.content,
      date: updated,
      author: item.source ? [{ name: item.source }] : [],
      category: (item.topics ?? []).slice(0, 20).map(name => ({ name })),
      // Custom Aegis namespace fields. The `feed` package serialises arbitrary
      // extension keys when present on the addItem options.
      extensions: [
        { name: "aegis:composite", objects: { _: item.scores.composite.toFixed(2) } },
        { name: "aegis:verdict", objects: { _: item.verdict } },
        ...(item.scores.vSignal !== undefined ? [{ name: "aegis:vSignal", objects: { _: item.scores.vSignal.toFixed(2) } }] : []),
        ...(item.scores.cContext !== undefined ? [{ name: "aegis:cContext", objects: { _: item.scores.cContext.toFixed(2) } }] : []),
        ...(item.scores.lSlop !== undefined ? [{ name: "aegis:lSlop", objects: { _: item.scores.lSlop.toFixed(2) } }] : []),
      ],
    });
  });

  return feed;
}

export const AEGIS_FEED_NAMESPACE = AEGIS_NS;
