import type { ContentManifest, ManifestEntry, ScoreBreakdown, Verdict } from "./types";
import { MIN_OFFER_SCORE } from "./protocol";

const MAX_MANIFEST_ENTRIES = 50;

/**
 * Minimal item shape consumed by buildManifest / diffManifest. Mirrors the
 * fields of Aegis's internal ContentItem that the manifest path actually
 * touches; consumers can pass a richer object — extra fields are ignored.
 */
export interface ManifestableItem {
  text: string;
  scores: ScoreBreakdown;
  verdict: Verdict;
  topics?: readonly string[];
}

/** SHA-256 of the canonicalized item text. The D2A spec mandates SHA-256. */
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function isQualified(
  c: ManifestableItem,
): c is ManifestableItem & { topics: readonly [string, ...string[]] } {
  return (
    c.verdict === "quality" &&
    c.scores.composite >= MIN_OFFER_SCORE &&
    !!c.topics &&
    c.topics.length > 0
  );
}

/** Build a manifest from a set of scored items. SubtleCrypto-backed (Node 20+ / browsers). */
export async function buildManifest(
  items: readonly ManifestableItem[],
): Promise<ContentManifest> {
  const qualified = items
    .filter(isQualified)
    .sort((a, b) => b.scores.composite - a.scores.composite)
    .slice(0, MAX_MANIFEST_ENTRIES);

  const entries: ManifestEntry[] = await Promise.all(
    qualified.map(async c => ({
      hash: await sha256Hex(c.text),
      topic: c.topics[0],
      score: Math.round(c.scores.composite * 10) / 10,
    })),
  );

  return { entries, generatedAt: Date.now() };
}

/** Decode a manifest received from a peer; returns null on shape failure. */
export function decodeManifest(raw: string): ContentManifest | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { entries?: unknown; generatedAt?: unknown };
  if (!Array.isArray(obj.entries) || typeof obj.generatedAt !== "number") return null;
  for (const entry of obj.entries) {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as ManifestEntry;
    if (
      typeof e.hash !== "string" ||
      typeof e.topic !== "string" ||
      typeof e.score !== "number" ||
      e.score < 0 ||
      e.score > 10
    ) {
      return null;
    }
  }
  return obj as ContentManifest;
}

/**
 * Returns items the peer hasn't seen AND that share at least one topic with
 * the peer's manifest. Sorted by composite descending — first item is the
 * natural offer candidate.
 */
export async function diffManifest(
  myContent: readonly ManifestableItem[],
  peerManifest: ContentManifest,
): Promise<ManifestableItem[]> {
  const peerHashes = new Set(peerManifest.entries.map(e => e.hash));
  const peerTopics = new Set(peerManifest.entries.map(e => e.topic));

  const candidates = myContent.filter(isQualified);
  const hashes = await Promise.all(candidates.map(c => sha256Hex(c.text)));
  return candidates
    .filter((c, i) => !peerHashes.has(hashes[i]) && c.topics.some(t => peerTopics.has(t)))
    .sort((a, b) => b.scores.composite - a.scores.composite);
}

export const MANIFEST_MAX_ENTRIES = MAX_MANIFEST_ENTRIES;
