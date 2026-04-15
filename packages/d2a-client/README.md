# @aegis/d2a-client

TypeScript SDK for the **D2A v1.0** protocol — direct agent-to-agent content exchange over Nostr, end-to-end encrypted via NIP-44.

This package gives a Node script, browser app, or React Native client everything it needs to:

- Discover live Aegis-compatible agents on Nostr.
- Compute Jaccard resonance against a peer's interests.
- Run the offer → accept → deliver handshake.
- Validate inbound D2A messages using the canonical schema.
- Build / decode / diff content manifests.

The wire format is documented in [`docs/D2A_PROTOCOL.md`](https://github.com/dwebxr/aegis/blob/main/docs/D2A_PROTOCOL.md). Constants in this package are kept in lockstep with the spec via the drift guard at `__tests__/docs/d2a-spec-constants.test.ts` in the main repo.

## Install

```sh
npm install @aegis/d2a-client nostr-tools
```

`nostr-tools` is a peer dependency — install it separately so the consumer controls the version.

## Quick start

```ts
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  broadcastPresence,
  discoverPeers,
  sendOffer,
  DEFAULT_RELAYS,
  MIN_OFFER_SCORE,
} from "@aegis/d2a-client";

// 1. Generate or load a Nostr identity.
const sk = generateSecretKey();
const pk = getPublicKey(sk);
const myPrefs = { topicAffinities: { rust: 0.9, "computational-biology": 0.8 } };

// 2. Announce yourself to the Nostr network.
await broadcastPresence({
  sk,
  interests: Object.keys(myPrefs.topicAffinities),
  capacity: 5,
  relayUrls: [...DEFAULT_RELAYS],
});

// 3. Find resonant peers (Jaccard >= 0.15).
const peers = await discoverPeers({
  myPubkey: pk,
  myPrefs,
  relayUrls: [...DEFAULT_RELAYS],
});
console.log(`Discovered ${peers.length} resonant peers`);

// 4. Offer one of your high-quality items to the top peer.
if (peers.length > 0) {
  await sendOffer(sk, pk, peers[0].nostrPubkey, {
    topic: "rust",
    score: 9.2,
    contentPreview: "First 500 chars of the article…",
  }, [...DEFAULT_RELAYS]);
}
```

A complete runnable example lives at [`examples/node-offer.ts`](./examples/node-offer.ts).

## API surface

| Group | Exports |
| --- | --- |
| Constants | `KIND_AGENT_PROFILE`, `KIND_EPHEMERAL`, `TAG_D2A_*`, `MAX_*`, `MIN_OFFER_SCORE`, `RESONANCE_THRESHOLD`, `INTEREST_BROADCAST_THRESHOLD`, `HANDSHAKE_TIMEOUT_MS`, `PRESENCE_BROADCAST_INTERVAL_MS`, `PEER_EXPIRY_MS`, `DISCOVERY_POLL_INTERVAL_MS`, `D2A_FEE_*`, `D2A_APPROVE_AMOUNT`, `DEFAULT_RELAYS`, `mergeRelays()` |
| Encryption | `encryptMessage()`, `decryptMessage()` |
| Manifest | `buildManifest()`, `decodeManifest()`, `diffManifest()`, `MANIFEST_MAX_ENTRIES` |
| Handshake | `sendOffer()`, `sendAccept()`, `sendReject()`, `deliverContent()`, `sendComment()`, `parseD2AMessage()`, `isHandshakeExpired()` |
| Discovery | `broadcastPresence()`, `discoverPeers()`, `calculateResonance()` |
| Types | `D2AMessage`, `D2AOfferPayload`, `D2ADeliverPayload`, `D2ACommentPayload`, `AgentProfile`, `HandshakeState`, `HandshakePhase`, `ContentManifest`, `ManifestableItem`, `ResonancePrefs`, `ScoreBreakdown`, `Verdict` |
| Versions | `SDK_VERSION`, `D2A_PROTOCOL_VERSION` |

The SDK exports zero React, Next.js, Internet Computer, or DOM-only globals. It runs in Node 20+, modern browsers, and React Native (with the standard Nostr-tools shims).

## Versioning

| Version | Means |
| --- | --- |
| `SDK_VERSION` (`0.1.0` and up) | The npm package's semver. Pre-`1.0`, expect API additions and the occasional refactor between minor versions. |
| `D2A_PROTOCOL_VERSION` (`1.0`) | The wire-format version. SDK majors and protocol majors evolve independently. |

The SDK starts at `0.1.0` because the surface still benefits from feedback. Once it stabilizes, `1.0.0` of the SDK will signal API stability — without changing the wire format.

## What's NOT in this package

- Aegis's scoring engine (V/C/L heuristics, Claude prompts) — that's app-internal today; might ship later as `@aegis/scoring`.
- IC canister access (`@dfinity/agent`) — D2A as a wire protocol does not require IC participation.
- React contexts, IndexedDB caches, or Aegis's preference-learning code — all app-internal.

## License

MIT — see [LICENSE](./LICENSE).

## See also

- [Aegis source](https://github.com/dwebxr/aegis)
- [D2A v1.0 spec](https://github.com/dwebxr/aegis/blob/main/docs/D2A_PROTOCOL.md)
- [Aegis API reference](https://aegis-ai.xyz/api-docs)
