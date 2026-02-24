import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { WoTGraph, WoTNode, WoTConfig } from "./types";
import { DEFAULT_WOT_CONFIG } from "./types";
import { withTimeout } from "@/lib/utils/timeout";
import { errMsg } from "@/lib/utils/errors";

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
              .map(tag => tag[1]);
            allFollows.set(author, follows);

            const existingNode = nodes.get(author);
            if (existingNode) {
              existingNode.follows = follows;
            }
          });
        } catch (err) {
          console.warn(`[wot] Batch ${i / BATCH_SIZE + 1} at hop ${hop} failed: ${errMsg(err)} — continuing with partial data`);
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

/** Exported for tests. Mutates node.mutualFollows in-place. */
export function calculateMutualFollows(nodes: Map<string, WoTNode>, userPubkey: string): void {
  const userNode = nodes.get(userPubkey);
  if (!userNode) return;

  // For each person the user follows, count their follows as mutual connections.
  // O(userFollows × avgFollowsPerUser) — typically much smaller than O(allNodes × avgFollowers).
  for (const followPubkey of userNode.follows) {
    const followNode = nodes.get(followPubkey);
    if (!followNode) continue;
    for (const target of followNode.follows) {
      if (target === userPubkey) continue;
      const targetNode = nodes.get(target);
      if (targetNode) {
        targetNode.mutualFollows++;
      }
    }
  }
}

