import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { WoTGraph, WoTNode, WoTConfig } from "./types";
import { DEFAULT_WOT_CONFIG } from "./types";
import { withTimeout } from "@/lib/utils/timeout";

const BATCH_SIZE = 50;

export async function buildFollowGraph(
  userPubkey: string,
  config: WoTConfig = DEFAULT_WOT_CONFIG,
  onProgress?: (hop: number, nodeCount: number) => void,
): Promise<WoTGraph> {
  const nodes = new Map<string, WoTNode>();
  const pool = new SimplePool();

  try {
    nodes.set(userPubkey, { pubkey: userPubkey, follows: [], hopDistance: 0, mutualFollows: 0 });

    let frontier: string[] = [userPubkey];

    for (let hop = 1; hop <= config.maxHops; hop++) {
      if (frontier.length === 0 || nodes.size >= config.maxNodes) break;

      const allFollows = new Map<string, string[]>();

      for (let i = 0; i < frontier.length; i += BATCH_SIZE) {
        if (nodes.size >= config.maxNodes) break;

        const batch = frontier.slice(i, i + BATCH_SIZE);
        const filter: Filter = { kinds: [3], authors: batch };

        try {
          const events = await withTimeout(
            pool.querySync(config.relays, filter),
            config.timeoutPerHopMs,
            "hop-timeout",
          );

          // Deduplicate Kind:3 by author (keep latest)
          const byAuthor = new Map<string, (typeof events)[0]>();
          for (const ev of events) {
            const existing = byAuthor.get(ev.pubkey);
            if (!existing || ev.created_at > existing.created_at) {
              byAuthor.set(ev.pubkey, ev);
            }
          }

          byAuthor.forEach((ev, author) => {
            const follows = ev.tags
              .filter((tag: string[]): tag is [string, string, ...string[]] =>
                tag[0] === "p" && typeof tag[1] === "string",
              )
              .map((tag: [string, string, ...string[]]) => tag[1]);
            allFollows.set(author, follows);

            const existingNode = nodes.get(author);
            if (existingNode) {
              existingNode.follows = follows;
            }
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[wot] Batch ${i / BATCH_SIZE + 1} at hop ${hop} failed: ${msg} — continuing with partial data`);
        }
      }

      const nextFrontier: string[] = [];
      allFollows.forEach((follows) => {
        for (const followPubkey of follows) {
          if (nodes.size >= config.maxNodes) return;
          if (!nodes.has(followPubkey)) {
            nodes.set(followPubkey, {
              pubkey: followPubkey,
              follows: [],
              hopDistance: hop,
              mutualFollows: 0,
            });
            nextFrontier.push(followPubkey);
          }
        }
      });

      frontier = nextFrontier;
      onProgress?.(hop, nodes.size);
    }

    calculateMutualFollows(nodes, userPubkey);

    return { userPubkey, nodes, maxHops: config.maxHops, builtAt: Date.now() };
  } finally {
    pool.destroy();
  }
}

function calculateMutualFollows(nodes: Map<string, WoTNode>, userPubkey: string): void {
  const userNode = nodes.get(userPubkey);
  if (!userNode) return;

  const userDirectFollows = new Set(userNode.follows);

  // Build reverse index: for each pubkey, which nodes follow them
  const followedBy = new Map<string, Set<string>>();
  nodes.forEach((node, pubkey) => {
    for (const followPubkey of node.follows) {
      let set = followedBy.get(followPubkey);
      if (!set) {
        set = new Set();
        followedBy.set(followPubkey, set);
      }
      set.add(pubkey);
    }
  });

  nodes.forEach((node, pubkey) => {
    if (pubkey === userPubkey) return;
    const followers = followedBy.get(pubkey);
    if (!followers) return;
    let mutual = 0;
    followers.forEach((follower) => {
      if (userDirectFollows.has(follower)) mutual++;
    });
    node.mutualFollows = mutual;
  });
}

export { calculateMutualFollows as _calculateMutualFollows };
