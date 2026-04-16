import { Feed } from "feed";
import type { D2ABriefingResponse, D2ABriefingItem } from "@/lib/d2a/types";
import { APP_URL } from "@/lib/config";

const SUMMARY_MAX_CHARS = 600;
const MAX_CATEGORIES = 20;

/** Code-point-safe truncation: never splits a UTF-16 surrogate pair (e.g. emoji). */
function truncateByCodePoint(text: string, maxChars: number): string {
  const codePoints = Array.from(text);
  if (codePoints.length <= maxChars) return text;
  return codePoints.slice(0, maxChars).join("").trimEnd() + "…";
}

function summarize(item: D2ABriefingItem): string {
  return `[score ${item.scores.composite.toFixed(1)}] ${truncateByCodePoint(item.content, SUMMARY_MAX_CHARS)}`;
}

function feedItemId(item: D2ABriefingItem, fallbackIndex: number, principal: string): string {
  if (item.sourceUrl) return item.sourceUrl;
  // Stable URN for items lacking a sourceUrl (e.g. raw nostr events without external link).
  return `urn:aegis:item:${principal}:${fallbackIndex}:${encodeURIComponent(item.title.slice(0, 80))}`;
}

interface BuildFeedOptions {
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

  for (const topic of briefing.meta.topics.slice(0, MAX_CATEGORIES)) {
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
      category: (item.topics ?? []).slice(0, MAX_CATEGORIES).map(name => ({ name })),
    });
  });

  return feed;
}

