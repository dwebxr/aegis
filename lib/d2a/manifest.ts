import type { ContentItem } from "@/lib/types/content";
import { MIN_OFFER_SCORE } from "@/lib/agent/protocol";
import { hashContent } from "@/lib/utils/hashing";

export { hashContent };

export interface ManifestEntry {
  hash: string;
  topic: string;
  score: number;
}

export interface ContentManifest {
  entries: ManifestEntry[];
  generatedAt: number;
}

const MAX_MANIFEST_ENTRIES = 50;

export function buildManifest(items: ContentItem[]): ContentManifest {
  const qualified = items
    .filter(c => c.verdict === "quality" && c.scores.composite >= MIN_OFFER_SCORE && c.topics && c.topics.length > 0)
    .sort((a, b) => b.scores.composite - a.scores.composite)
    .slice(0, MAX_MANIFEST_ENTRIES);

  const entries: ManifestEntry[] = qualified.map(c => ({
    hash: hashContent(c.text),
    topic: c.topics![0],
    score: Math.round(c.scores.composite * 10) / 10,
  }));

  return { entries, generatedAt: Date.now() };
}

export function decodeManifest(raw: string): ContentManifest | null {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[manifest] Failed to decode peer manifest:", raw.slice(0, 100));
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.entries) ||
    typeof parsed.generatedAt !== "number"
  ) {
    return null;
  }
  for (const entry of parsed.entries) {
    if (!entry || typeof entry !== "object" || typeof entry.hash !== "string" || typeof entry.topic !== "string" || typeof entry.score !== "number") {
      return null;
    }
  }
  return parsed as ContentManifest;
}

export function diffManifest(
  myContent: ContentItem[],
  peerManifest: ContentManifest,
): ContentItem[] {
  const peerHashes = new Set(peerManifest.entries.map(e => e.hash));
  const peerTopics = new Set(peerManifest.entries.map(e => e.topic));

  return myContent
    .filter(c =>
      c.verdict === "quality" &&
      c.scores.composite >= MIN_OFFER_SCORE &&
      c.topics &&
      c.topics.length > 0 &&
      !peerHashes.has(hashContent(c.text)) &&
      c.topics.some(t => peerTopics.has(t)),
    )
    .sort((a, b) => b.scores.composite - a.scores.composite);
}
