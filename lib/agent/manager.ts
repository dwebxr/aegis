import { v4 as uuidv4 } from "uuid";
import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";
import type { AgentProfile, AgentState, HandshakeState, D2AMessage, D2AOfferPayload, D2ADeliverPayload } from "./types";
import { broadcastPresence, discoverPeers, calculateResonance } from "./discovery";
import { sendOffer, sendAccept, sendReject, deliverContent, parseD2AMessage, isHandshakeExpired } from "./handshake";
import {
  KIND_EPHEMERAL,
  PRESENCE_BROADCAST_INTERVAL_MS,
  DISCOVERY_POLL_INTERVAL_MS,
  MIN_OFFER_SCORE,
} from "./protocol";
import type { SubCloser } from "nostr-tools/pool";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

interface AgentManagerCallbacks {
  onNewContent: (item: ContentItem) => void;
  getContent: () => ContentItem[];
  getPrefs: () => UserPreferenceProfile;
  onStateChange: (state: AgentState) => void;
}

export class AgentManager {
  private sk: Uint8Array;
  private pk: string;
  private callbacks: AgentManagerCallbacks;
  private relayUrls: string[];

  private peers: Map<string, AgentProfile> = new Map();
  private handshakes: Map<string, HandshakeState> = new Map();
  private receivedItems = 0;
  private sentItems = 0;

  private presenceInterval: ReturnType<typeof setInterval> | null = null;
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;
  private listenerPool: SimplePool | null = null;
  private listenerSub: SubCloser | null = null;
  private active = false;

  constructor(
    sk: Uint8Array,
    pk: string,
    callbacks: AgentManagerCallbacks,
    relayUrls?: string[],
  ) {
    this.sk = sk;
    this.pk = pk;
    this.callbacks = callbacks;
    this.relayUrls = relayUrls || DEFAULT_RELAYS;
  }

  async start(): Promise<void> {
    this.active = true;
    this.emitState();

    // Initial presence broadcast
    try {
      await this.broadcastMyPresence();
    } catch (err) {
      console.warn("[agent] Initial presence broadcast failed:", err instanceof Error ? err.message : "unknown");
    }

    // Periodic presence
    this.presenceInterval = setInterval(() => {
      this.broadcastMyPresence().catch(err => console.warn("[agent] Presence broadcast failed:", err instanceof Error ? err.message : "unknown"));
    }, PRESENCE_BROADCAST_INTERVAL_MS);

    // Initial peer discovery
    try {
      await this.discoverAndNegotiate();
    } catch (err) {
      console.warn("[agent] Initial discovery failed:", err instanceof Error ? err.message : "unknown");
    }

    // Periodic discovery
    this.discoveryInterval = setInterval(() => {
      this.discoverAndNegotiate().catch(err => console.warn("[agent] Discovery/negotiate failed:", err instanceof Error ? err.message : "unknown"));
    }, DISCOVERY_POLL_INTERVAL_MS);

    // Subscribe to incoming D2A messages
    this.subscribeToMessages();
  }

  stop(): void {
    this.active = false;
    if (this.presenceInterval) clearInterval(this.presenceInterval);
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    this.presenceInterval = null;
    this.discoveryInterval = null;
    this.listenerSub?.close();
    this.listenerSub = null;
    this.listenerPool?.destroy();
    this.listenerPool = null;
    this.emitState();
  }

  getState(): AgentState {
    return {
      isActive: this.active,
      myPubkey: this.pk,
      peers: Array.from(this.peers.values()),
      activeHandshakes: Array.from(this.handshakes.values()).filter(h => !isHandshakeExpired(h)),
      receivedItems: this.receivedItems,
      sentItems: this.sentItems,
    };
  }

  private emitState(): void {
    this.callbacks.onStateChange(this.getState());
  }

  private async broadcastMyPresence(): Promise<void> {
    const prefs = this.callbacks.getPrefs();
    const interests = Object.entries(prefs.topicAffinities)
      .filter(([, v]) => v >= 0.2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([k]) => k);

    await broadcastPresence(this.sk, interests, 5, this.relayUrls);
  }

  private cleanupStaleHandshakes(): void {
    const toDelete: string[] = [];
    this.handshakes.forEach((hs, peerId) => {
      if (hs.phase === "completed" || hs.phase === "rejected" || isHandshakeExpired(hs)) {
        toDelete.push(peerId);
      }
    });
    for (const peerId of toDelete) {
      this.handshakes.delete(peerId);
    }
  }

  private async discoverAndNegotiate(): Promise<void> {
    // Remove completed/rejected/expired handshakes so peers can be re-offered
    this.cleanupStaleHandshakes();

    const prefs = this.callbacks.getPrefs();
    const discovered = await discoverPeers(this.pk, prefs, this.relayUrls);

    // Update peer map
    for (const peer of discovered) {
      this.peers.set(peer.nostrPubkey, peer);
    }
    this.emitState();

    // Look for content to offer to compatible peers
    const content = this.callbacks.getContent();
    const offerCandidates = content.filter(c =>
      c.verdict === "quality" &&
      c.scores.composite >= MIN_OFFER_SCORE &&
      c.topics &&
      c.topics.length > 0
    );

    for (const peer of discovered) {
      // Don't send offers to peers with active (in-progress) handshakes
      const existing = this.handshakes.get(peer.nostrPubkey);
      if (existing && (existing.phase === "offered" || existing.phase === "accepted" || existing.phase === "delivering")) continue;

      // Find best content to offer this peer
      const match = offerCandidates.find(c =>
        c.topics?.some(t => peer.interests.includes(t))
      );

      if (match && match.topics) {
        const offer: D2AOfferPayload = {
          topic: match.topics[0],
          score: match.scores.composite,
          contentPreview: match.text.slice(0, 100),
        };

        try {
          const handshake = await sendOffer(
            this.sk, this.pk, peer.nostrPubkey, offer, this.relayUrls,
          );
          this.handshakes.set(peer.nostrPubkey, handshake);
          this.emitState();
        } catch (err) {
          console.warn("[agent] sendOffer failed:", err instanceof Error ? err.message : "unknown");
        }
      }
    }
  }

  private subscribeToMessages(): void {
    this.listenerPool = new SimplePool();

    const filter: Filter = {
      kinds: [KIND_EPHEMERAL],
      "#p": [this.pk],
      since: Math.floor(Date.now() / 1000) - 60,
    };

    this.listenerSub = this.listenerPool.subscribe(this.relayUrls, filter, {
      onevent: (event) => {
        this.handleIncomingMessage(event.pubkey, event.content)
          .catch(err => console.warn("[agent] Message handler failed:", err instanceof Error ? err.message : "unknown"));
      },
    });
  }

  private async handleIncomingMessage(senderPk: string, encryptedContent: string): Promise<void> {
    let message: D2AMessage | null;
    try {
      message = parseD2AMessage(encryptedContent, this.sk, senderPk);
    } catch {
      return; // Invalid message
    }
    if (!message) return;

    switch (message.type) {
      case "offer":
        await this.handleOffer(senderPk, message.payload as D2AOfferPayload);
        break;
      case "accept":
        await this.handleAccept(senderPk);
        break;
      case "reject":
        this.handleReject(senderPk);
        break;
      case "deliver":
        this.handleDelivery(senderPk, message.payload as D2ADeliverPayload);
        break;
    }
  }

  private async handleOffer(senderPk: string, offer: D2AOfferPayload): Promise<void> {
    const prefs = this.callbacks.getPrefs();
    const topicAffinity = prefs.topicAffinities[offer.topic] ?? 0;

    try {
      if (topicAffinity > 0 && offer.score >= 6) {
        await sendAccept(this.sk, this.pk, senderPk, this.relayUrls);
        this.handshakes.set(senderPk, {
          peerId: senderPk,
          phase: "accepted",
          offeredTopic: offer.topic,
          offeredScore: offer.score,
          startedAt: Date.now(),
        });
      } else {
        await sendReject(this.sk, this.pk, senderPk, this.relayUrls);
        this.handshakes.set(senderPk, {
          peerId: senderPk,
          phase: "rejected",
          offeredTopic: offer.topic,
          offeredScore: offer.score,
          startedAt: Date.now(),
          completedAt: Date.now(),
        });
      }
    } catch (err) {
      console.warn("[agent] handleOffer relay send failed:", err instanceof Error ? err.message : "unknown");
    }
    this.emitState();
  }

  private async handleAccept(senderPk: string): Promise<void> {
    const handshake = this.handshakes.get(senderPk);
    if (!handshake || handshake.phase !== "offered") return;

    handshake.phase = "delivering";

    const content = this.callbacks.getContent();
    const match = content.find(c =>
      c.topics?.includes(handshake.offeredTopic) &&
      c.scores.composite >= handshake.offeredScore - 0.5
    );

    if (!match) {
      handshake.phase = "rejected";
      handshake.completedAt = Date.now();
      this.emitState();
      return;
    }

    const payload: D2ADeliverPayload = {
      text: match.text,
      author: match.author,
      scores: match.scores,
      verdict: match.verdict,
      topics: match.topics || [],
      vSignal: match.vSignal,
      cContext: match.cContext,
      lSlop: match.lSlop,
    };

    try {
      await deliverContent(this.sk, this.pk, senderPk, payload, this.relayUrls);
      handshake.phase = "completed";
      handshake.completedAt = Date.now();
      this.sentItems++;
    } catch (err) {
      console.warn("[agent] deliverContent failed:", err instanceof Error ? err.message : "unknown");
      handshake.phase = "rejected";
      handshake.completedAt = Date.now();
    }
    this.emitState();
  }

  private handleReject(senderPk: string): void {
    const handshake = this.handshakes.get(senderPk);
    if (handshake) {
      handshake.phase = "rejected";
      handshake.completedAt = Date.now();
    }
    this.emitState();
  }

  private handleDelivery(senderPk: string, payload: D2ADeliverPayload): void {
    // Validate the content against our own preferences before accepting
    const prefs = this.callbacks.getPrefs();
    const peerProfile = this.peers.get(senderPk);
    if (peerProfile) {
      const resonance = calculateResonance(prefs, peerProfile);
      if (resonance < 0.1) return; // Very low resonance, ignore
    }

    // Convert to ContentItem and inject into feed
    const item: ContentItem = {
      id: uuidv4(),
      owner: "",
      author: payload.author,
      avatar: "\uD83E\uDD16", // robot face for D2A-received content
      text: payload.text,
      source: "nostr",
      scores: payload.scores,
      verdict: payload.verdict,
      reason: `Received via D2A from ${senderPk.slice(0, 8)}...`,
      createdAt: Date.now(),
      validated: false,
      flagged: false,
      timestamp: "just now",
      topics: payload.topics,
      vSignal: payload.vSignal,
      cContext: payload.cContext,
      lSlop: payload.lSlop,
    };

    this.callbacks.onNewContent(item);
    this.receivedItems++;

    // Complete handshake
    const handshake = this.handshakes.get(senderPk);
    if (handshake) {
      handshake.phase = "completed";
      handshake.completedAt = Date.now();
    }
    this.emitState();
  }
}
