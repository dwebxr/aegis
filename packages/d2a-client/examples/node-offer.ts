/**
 * @aegis/d2a-client — Node example.
 *
 * Run from the package directory:
 *   npm install --include=dev
 *   npm install nostr-tools tsx
 *   npx tsx examples/node-offer.ts
 *
 * This script:
 *  1. Generates a throwaway Nostr keypair.
 *  2. Broadcasts presence with three interest topics.
 *  3. Polls Nostr for resonant Aegis peers (Jaccard >= 0.15).
 *  4. Logs each discovered peer with its resonance score.
 *  5. If at least one peer was found, sends them an offer.
 *
 * No credentials are required. The script uses the default Aegis relays.
 */

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  broadcastPresence,
  discoverPeers,
  sendOffer,
  DEFAULT_RELAYS,
  DISCOVERY_POLL_INTERVAL_MS,
  type ResonancePrefs,
} from "../src";

async function main(): Promise<void> {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const relays = [...DEFAULT_RELAYS];

  const myPrefs: ResonancePrefs = {
    topicAffinities: {
      "rust": 0.9,
      "computational-biology": 0.8,
      "machine-learning": 0.7,
    },
  };
  const interests = Object.keys(myPrefs.topicAffinities);

  console.log(`[d2a-example] my pubkey: ${pk}`);
  console.log(`[d2a-example] interests: ${interests.join(", ")}`);
  console.log(`[d2a-example] relays:    ${relays.join(", ")}`);

  console.log("[d2a-example] broadcasting presence…");
  await broadcastPresence({ sk, interests, capacity: 5, relayUrls: relays });

  // Allow relays a moment to propagate our presence and surface peers'.
  await new Promise(r => setTimeout(r, Math.min(5000, DISCOVERY_POLL_INTERVAL_MS / 12)));

  console.log("[d2a-example] discovering peers…");
  const peers = await discoverPeers({ myPubkey: pk, myPrefs, relayUrls: relays });
  console.log(`[d2a-example] resonant peers: ${peers.length}`);
  for (const p of peers) {
    const score = (p.resonance ?? 0).toFixed(3);
    console.log(`  - ${p.nostrPubkey.slice(0, 12)}… resonance=${score} interests=[${p.interests.join(",")}]`);
  }

  if (peers.length === 0) {
    console.log("[d2a-example] no peers above threshold — nothing to offer.");
    return;
  }

  const target = peers[0];
  console.log(`[d2a-example] offering to ${target.nostrPubkey.slice(0, 12)}…`);
  await sendOffer(sk, pk, target.nostrPubkey, {
    topic: "rust",
    score: 9.2,
    contentPreview: "Demo offer from @aegis/d2a-client example script.",
  }, relays);
  console.log("[d2a-example] offer sent. Watch your relays for accept/reject.");
}

main().catch(err => {
  console.error("[d2a-example] failed:", err);
  process.exitCode = 1;
});
