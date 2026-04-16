import type { ContentItem } from "@/lib/types/content";
import type { WoTGraph } from "@/lib/wot/types";
import type { PeerReputation, TrustTier } from "./reputation";
import { calculateEffectiveTrust, getTrustTier } from "./reputation";
import { isD2AContent } from "./activity";
import { calculateWoTScore } from "@/lib/wot/scorer";
import { npubEncode } from "nostr-tools/nip19";

interface PeerStat {
  pubkey: string;
  displayName: string;
  itemsReceived: number;
  validated: number;
  flagged: number;
  qualityRate: number;
  reputation: PeerReputation;
  trustTier: TrustTier;
  wotScore: number;
  effectiveTrust: number;
}

export type PeerSortKey = "effectiveTrust" | "itemsReceived" | "qualityRate" | "reputation";

const DEFAULT_REP: PeerReputation = {
  pubkey: "",
  useful: 0,
  slop: 0,
  score: 0,
  blocked: false,
  updatedAt: 0,
};

function shortenNpub(pubkey: string): string {
  try {
    const npub = npubEncode(pubkey);
    return npub.slice(0, 12) + "..." + npub.slice(-4);
  } catch {
    return pubkey.slice(0, 8) + "...";
  }
}

export function computePeerStats(
  content: ContentItem[],
  reputations: Map<string, PeerReputation>,
  wotGraph: WoTGraph | null,
): PeerStat[] {
  const d2aItems = content.filter(isD2AContent);

  const grouped = new Map<string, ContentItem[]>();
  for (const item of d2aItems) {
    const pk = item.nostrPubkey ?? "unknown";
    const list = grouped.get(pk);
    if (list) list.push(item);
    else grouped.set(pk, [item]);
  }

  const stats: PeerStat[] = [];
  for (const [pubkey, items] of grouped) {
    let validated = 0;
    let flagged = 0;
    let judged = 0;
    for (const i of items) {
      if (i.validated) validated++;
      if (i.flagged) flagged++;
      if (i.validated || i.flagged) judged++;
    }
    const qualityRate = judged > 0 ? validated / judged : 0;

    const rep = reputations.get(pubkey) ?? { ...DEFAULT_REP, pubkey };
    const wot = wotGraph ? calculateWoTScore(pubkey, wotGraph) : { trustScore: 0 };
    const effectiveTrust = calculateEffectiveTrust(wot.trustScore, rep.score);
    const trustTier = getTrustTier(effectiveTrust);

    stats.push({
      pubkey,
      displayName: pubkey === "unknown" ? "Unknown Peer" : shortenNpub(pubkey),
      itemsReceived: items.length,
      validated,
      flagged,
      qualityRate,
      reputation: rep,
      trustTier,
      wotScore: wot.trustScore,
      effectiveTrust,
    });
  }

  return stats;
}

const SORT_ACCESSORS: Record<PeerSortKey, (s: PeerStat) => number> = {
  effectiveTrust: s => s.effectiveTrust,
  itemsReceived: s => s.itemsReceived,
  qualityRate: s => s.qualityRate,
  reputation: s => s.reputation.score,
};

export function sortPeerStats(stats: PeerStat[], key: PeerSortKey, desc = true): PeerStat[] {
  const accessor = SORT_ACCESSORS[key];
  return [...stats].sort((a, b) => desc ? accessor(b) - accessor(a) : accessor(a) - accessor(b));
}
