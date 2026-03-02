import type { BriefingState } from "./types";
import type { ContentItem } from "@/lib/types/content";

export interface SerializedBriefing {
  content: string;
  tags: string[][];
  identifier: string;
}

export interface ParsedBriefingItem {
  rank: number | null;
  isSerendipity: boolean;
  title: string;
  text: string;
  composite: number;
  verdict: string;
  reason: string;
  topics: string[];
  sourceUrl?: string;
}

export interface ParsedBriefing {
  title: string;
  summary: string;
  items: ParsedBriefingItem[];
  totalItems: number;
  insightCount: number;
  generatedAt: number;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function itemTitle(item: ContentItem): string {
  const raw = item.text || "Untitled";
  const firstLine = raw.split("\n")[0];
  return truncate(firstLine, 80);
}

/** Render a single briefing item's body lines (reason, text, topics, source). */
function renderItemBody(it: ContentItem, lines: string[]): void {
  if (it.reason) lines.push(`> ${truncate(it.reason, 200)}`);
  if (it.text) lines.push(`${truncate(it.text, 280)}`);
  if (it.topics && it.topics.length > 0) {
    lines.push(`Topics: ${it.topics.map(t => "#" + t).join(" ")}`);
  }
  if (it.sourceUrl) lines.push(`[Source](${it.sourceUrl})`);
}

export function serializeBriefing(
  briefing: BriefingState,
  digest?: string,
): SerializedBriefing {
  const identifier = `briefing-${briefing.generatedAt}`;
  const dateStr = new Date(briefing.generatedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
  const insightCount = briefing.priority.length + (briefing.serendipity ? 1 : 0);
  const burned = briefing.totalItems - insightCount;

  const title = `Aegis Briefing — ${dateStr}`;
  const topItem = briefing.priority[0];
  const summary = topItem
    ? `${insightCount} insights curated. Top: ${truncate(itemTitle(topItem.item), 60)} (${topItem.item.scores.composite.toFixed(1)}/10)`
    : `${insightCount} insights curated from ${briefing.totalItems} items.`;

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`*${insightCount} insights selected from ${briefing.totalItems} items. ${burned} burned as slop.*`);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (digest) {
    lines.push(`> **Digest:** ${digest}`);
    lines.push("");
  }

  if (briefing.priority.length > 0) {
    lines.push("## Priority Briefing");
    lines.push("");

    briefing.priority.forEach((b, i) => {
      const it = b.item;
      lines.push(`### #${i + 1}: ${itemTitle(it)}`);
      lines.push(`**Score: ${it.scores.composite.toFixed(1)}/10** | Verdict: ${it.verdict}`);
      renderItemBody(it, lines);
      lines.push("");
    });
  }

  if (briefing.serendipity) {
    lines.push("---");
    lines.push("");
    lines.push("## Serendipity Pick");
    lines.push("");
    const it = briefing.serendipity.item;
    lines.push(`### ${itemTitle(it)}`);
    lines.push(`**Score: ${it.scores.composite.toFixed(1)}/10** | Novelty bonus applied`);
    renderItemBody(it, lines);
    lines.push("");
    lines.push("*Selected outside your usual topics to prevent filter bubbles.*");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("*Curated by [Aegis](https://aegis.dwebxr.xyz) — AI Content Quality Filter*");

  const allItems = [...briefing.priority.map(b => b.item), ...(briefing.serendipity ? [briefing.serendipity.item] : [])];
  const allTopics = new Set(allItems.flatMap(i => i.topics || []));

  const now = Math.floor(Date.now() / 1000);
  const tags: string[][] = [
    ["d", identifier],
    ["title", title],
    ["summary", summary],
    ["published_at", String(now)],
    ["t", "aegis"],
    ["t", "briefing"],
    ["t", "ai-curation"],
    ["client", "aegis", "https://aegis.dwebxr.xyz"],
    ...Array.from(allTopics).slice(0, 10).map(t => ["t", t]),
  ];

  return { content: lines.join("\n"), tags, identifier };
}

export function parseBriefingMarkdown(
  content: string,
  tags: string[][],
): ParsedBriefing {
  const title = tags.find(t => t[0] === "title")?.[1] || "Aegis Briefing";
  const summary = tags.find(t => t[0] === "summary")?.[1] || "";
  const publishedAt = tags.find(t => t[0] === "published_at")?.[1];
  const generatedAt = publishedAt ? Number(publishedAt) * 1000 : Date.now();

  const items: ParsedBriefingItem[] = [];
  let totalItems = 0;

  const lines = content.split("\n");
  let currentItem: Partial<ParsedBriefingItem> | null = null;
  let inSerendipity = false;

  for (const line of lines) {
    const statsMatch = line.match(/\*(\d+)\s+insights?\s+selected\s+from\s+(\d+)\s+items/);
    if (statsMatch) {
      totalItems = parseInt(statsMatch[2], 10);
    }

    if (line.startsWith("## Serendipity Pick")) {
      inSerendipity = true;
      continue;
    }

    if (line.startsWith("## Priority Briefing")) {
      inSerendipity = false;
      continue;
    }

    // Item heading: ### #1: Title or ### Title (serendipity)
    const itemMatch = line.match(/^### (?:#(\d+): )?(.+)$/);
    if (itemMatch) {
      if (currentItem && currentItem.title) {
        items.push(finishItem(currentItem, inSerendipity));
      }
      currentItem = {
        rank: itemMatch[1] ? parseInt(itemMatch[1], 10) : null,
        isSerendipity: inSerendipity,
        title: itemMatch[2],
        text: "",
        composite: 0,
        verdict: "quality",
        reason: "",
        topics: [],
      };
      continue;
    }

    if (!currentItem) continue;

    const scoreMatch = line.match(/\*\*Score:\s*([\d.]+)\/10\*\*\s*\|\s*(?:Verdict:\s*(\w+)|Novelty)/);
    if (scoreMatch) {
      const parsed = parseFloat(scoreMatch[1]);
      currentItem.composite = Number.isNaN(parsed) ? 0 : parsed;
      if (scoreMatch[2]) currentItem.verdict = scoreMatch[2];
      continue;
    }

    if (line.startsWith("> ")) {
      currentItem.reason = line.slice(2);
      continue;
    }

    const topicMatch = line.match(/^Topics:\s*(.+)$/);
    if (topicMatch) {
      currentItem.topics = topicMatch[1].split(/\s+/).map(t => t.replace(/^#/, "")).filter(Boolean);
      continue;
    }

    const sourceMatch = line.match(/^\[Source\]\((.+)\)$/);
    if (sourceMatch) {
      currentItem.sourceUrl = sourceMatch[1];
      continue;
    }

    if (line.trim() && !line.startsWith("#") && !line.startsWith("---") && !line.startsWith("*")) {
      if (currentItem.text) {
        currentItem.text += "\n" + line;
      } else {
        currentItem.text = line;
      }
    }
  }

  if (currentItem && currentItem.title) {
    items.push(finishItem(currentItem, inSerendipity));
  }

  return {
    title,
    summary,
    items,
    totalItems: totalItems || items.length,
    insightCount: items.length,
    generatedAt,
  };
}

function finishItem(partial: Partial<ParsedBriefingItem>, isSerendipity: boolean): ParsedBriefingItem {
  return {
    rank: partial.rank ?? null,
    isSerendipity: partial.isSerendipity ?? isSerendipity,
    title: partial.title || "Untitled",
    text: partial.text || "",
    composite: partial.composite || 0,
    verdict: partial.verdict || "quality",
    reason: partial.reason || "",
    topics: partial.topics || [],
    sourceUrl: partial.sourceUrl,
  };
}
