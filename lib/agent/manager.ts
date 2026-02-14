import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { v4 as uuidv4 } from "uuid";
import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";
import type { WoTGraph } from "@/lib/wot/types";
import type { AgentProfile, AgentState, HandshakeState, D2AOfferPayload, D2ADeliverPayload } from "./types";
import { broadcastPresence, discoverPeers, calculateResonance } from "./discovery";
import { sendOffer, sendAccept, sendReject, deliverContent, parseD2AMessage, isHandshakeExpired } from "./handshake";
import {
  KIND_EPHEMERAL,
  PRESENCE_BROADCAST_INTERVAL_MS,
  DISCOVERY_POLL_INTERVAL_MS,
  PEER_EXPIRY_MS,
  MIN_OFFER_SCORE,
} from "./protocol";
import type { SubCloser } from "nostr-tools/pool";
import { errMsg } from "@/lib/utils/errors";
import { DEFAULT_RELAYS } from "@/lib/nostr/types";
import { calculateWoTScore } from "@/lib/wot/scorer";
import {
  isBlocked,
  getReputation,
  calculateEffectiveTrust,
  getTrustTier,
  calculateDynamicFee,
} from "@/lib/d2a/reputation";
import { diffManifest } from "@/lib/d2a/manifest";

interface AgentManagerCallbacks {
  onNewContent: (item: ContentItem) => void;
  getContent: () => ContentItem[];
  getPrefs: () => UserPreferenceProfile;
  onStateChange: (state: AgentState) => void;
  onD2AMatchComplete?: (senderPk: string, senderPrincipalId: string | undefined, contentHash: string, fee: number) => void | Promise<void>;
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
  private d2aMatchCount = 0;
  private consecutiveErrors = 0;
  private lastError?: string;

  private presenceInterval: ReturnType<typeof setTimeout> | null = null;
  private discoveryInterval: ReturnType<typeof setTimeout> | null = null;
  private listenerPool: SimplePool | null = null;
  private listenerSub: SubCloser | null = null;
  private active = false;

  private principalId?: string;
  private wotGraph: WoTGraph | null = null;

  constructor(
    sk: Uint8Array,
    pk: string,
    callbacks: AgentManagerCallbacks,
    relayUrls?: string[],
    principalId?: string,
    wotGraph?: WoTGraph | null,
  ) {
    this.sk = sk;
    this.pk = pk;
    this.callbacks = callbacks;
    this.relayUrls = relayUrls || DEFAULT_RELAYS;
    this.principalId = principalId;
    this.wotGraph = wotGraph ?? null;
  }

  setWoTGraph(graph: WoTGraph | null): void {
    this.wotGraph = graph;
  }

  /** Compute delay with exponential backoff: base * 2^(errors-1), capped at 15min */
  private backoffDelay(baseMs: number): number {
    if (this.consecutiveErrors === 0) return baseMs;
    return Math.min(baseMs * Math.pow(2, this.consecutiveErrors - 1), 15 * 60 * 1000);
  }

  private schedulePresence(): void {
    if (!this.active) return;
    const delay = this.backoffDelay(PRESENCE_BROADCAST_INTERVAL_MS);
    this.presenceInterval = setTimeout(() => {
      this.broadcastMyPresence()
        .then(() => this.clearErrors())
        .catch(err => {
          this.recordError(errMsg(err));
          console.warn("[agent] Presence broadcast failed:", errMsg(err));
        })
        .finally(() => this.schedulePresence());
    }, delay);
  }

  private scheduleDiscovery(): void {
    if (!this.active) return;
    const delay = this.backoffDelay(DISCOVERY_POLL_INTERVAL_MS);
    this.discoveryInterval = setTimeout(() => {
      this.discoverAndNegotiate()
        .then(() => this.clearErrors())
        .catch(err => {
          this.recordError(errMsg(err));
          console.warn("[agent] Discovery/negotiate failed:", errMsg(err));
        })
        .finally(() => this.scheduleDiscovery());
    }, delay);
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.emitState();

    try {
      await this.broadcastMyPresence();
      this.clearErrors();
    } catch (err) {
      this.recordError(errMsg(err));
      console.warn("[agent] Initial presence broadcast failed:", errMsg(err));
    }

    this.schedulePresence();

    try {
      await this.discoverAndNegotiate();
      this.clearErrors();
    } catch (err) {
      this.recordError(errMsg(err));
      console.warn("[agent] Initial discovery failed:", errMsg(err));
    }

    this.scheduleDiscovery();

    this.subscribeToMessages();
  }

  stop(): void {
    this.active = false;
    if (this.presenceInterval) clearTimeout(this.presenceInterval);
    if (this.discoveryInterval) clearTimeout(this.discoveryInterval);
    this.presenceInterval = null;
    this.discoveryInterval = null;
    this.listenerSub?.close();
    this.listenerSub = null;
    this.listenerPool?.destroy();
    this.listenerPool = null;
    this.peers.clear();
    this.handshakes.clear();
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
      d2aMatchCount: this.d2aMatchCount,
      consecutiveErrors: this.consecutiveErrors,
      lastError: this.lastError,
    };
  }

  private emitState(): void {
    this.callbacks.onStateChange(this.getState());
  }

  private recordError(msg: string): void {
    this.consecutiveErrors++;
    this.lastError = msg;
    this.emitState();
  }

  private clearErrors(): void {
    if (this.consecutiveErrors > 0) {
      this.consecutiveErrors = 0;
      this.lastError = undefined;
      this.emitState();
    }
  }

  private async broadcastMyPresence(): Promise<void> {
    const prefs = this.callbacks.getPrefs();
    const interests = Object.entries(prefs.topicAffinities || {})
      .filter(([, v]) => v >= 0.2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([k]) => k);

    const content = this.callbacks.getContent();
    await broadcastPresence(this.sk, interests, 5, this.relayUrls, this.principalId, content);
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

  private cleanupStalePeers(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    this.peers.forEach((peer, pk) => {
      if (now - peer.lastSeen > PEER_EXPIRY_MS) {
        toDelete.push(pk);
      }
    });
    for (const pk of toDelete) {
      this.peers.delete(pk);
    }
  }

  private async discoverAndNegotiate(): Promise<void> {
    this.cleanupStaleHandshakes();
    this.cleanupStalePeers();

    const prefs = this.callbacks.getPrefs();
    const discovered = await discoverPeers(this.pk, prefs, this.relayUrls);

    for (const peer of discovered) {
      this.peers.set(peer.nostrPubkey, peer);
    }
    this.emitState();

    const content = this.callbacks.getContent();
    const offerCandidates = content.filter(c =>
      c.verdict === "quality" &&
      c.scores.composite >= MIN_OFFER_SCORE &&
      c.topics &&
      c.topics.length > 0
    );

    for (const peer of discovered) {
      const existing = this.handshakes.get(peer.nostrPubkey);
      if (existing && (existing.phase === "offered" || existing.phase === "accepted" || existing.phase === "delivering")) continue;
      if (isBlocked(peer.nostrPubkey)) continue;
      if (peer.capacity <= 0) continue;
      let match: ContentItem | undefined;
      if (peer.manifest) {
        const diffItems = diffManifest(offerCandidates, peer.manifest);
        match = diffItems[0];
      } else {
        const peerInterests = new Set(peer.interests);
        match = offerCandidates.find(c =>
          c.topics?.some(t => peerInterests.has(t))
        );
      }

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
          console.warn("[agent] sendOffer failed:", errMsg(err));
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
          .catch(err => console.warn("[agent] Message handler failed:", errMsg(err)));
      },
    });
  }

  private async handleIncomingMessage(senderPk: string, encryptedContent: string): Promise<void> {
    const message = parseD2AMessage(encryptedContent, this.sk, senderPk);
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
        await this.handleDelivery(senderPk, message.payload as D2ADeliverPayload);
        break;
    }
  }

  private async handleOffer(senderPk: string, offer: D2AOfferPayload): Promise<void> {
    const prefs = this.callbacks.getPrefs();
    const topicAffinity = (prefs.topicAffinities || {})[offer.topic] ?? 0;

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
      console.warn("[agent] handleOffer relay send failed:", errMsg(err));
    }
    this.emitState();
  }

  private async handleAccept(senderPk: string): Promise<void> {
    const handshake = this.handshakes.get(senderPk);
    if (!handshake || handshake.phase !== "offered") return;

    // Find matching content BEFORE transitioning state to avoid inconsistent "delivering" with no content
    const content = this.callbacks.getContent();
    const match = content.find(c =>
      c.topics?.includes(handshake.offeredTopic) &&
      c.scores.composite >= handshake.offeredScore - 0.5
    );

    if (!match) {
      console.warn(`[agent] handleAccept: content no longer available for topic="${handshake.offeredTopic}", rejecting`);
      handshake.phase = "rejected";
      handshake.completedAt = Date.now();
      this.emitState();
      return;
    }

    handshake.phase = "delivering";

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
      console.warn("[agent] deliverContent failed:", errMsg(err));
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

  private async handleDelivery(senderPk: string, payload: D2ADeliverPayload): Promise<void> {
    const prefs = this.callbacks.getPrefs();
    const peerProfile = this.peers.get(senderPk);

    // Reject deliveries from undiscovered peers — no profile means no trust
    if (!peerProfile) return;

    if (isBlocked(senderPk)) return;

    const resonance = calculateResonance(prefs, peerProfile);
    if (resonance < 0.1) return;

    const wotScore = this.wotGraph
      ? calculateWoTScore(senderPk, this.wotGraph).trustScore
      : 0;
    const repData = getReputation(senderPk);
    const repScore = repData?.score ?? 0;
    const effectiveTrust = calculateEffectiveTrust(wotScore, repScore);
    const tier = getTrustTier(effectiveTrust);

    // Restricted tier = reject delivery silently
    if (tier === "restricted") return;

    const fee = calculateDynamicFee(tier);

    const item: ContentItem = {
      id: uuidv4(),
      owner: "",
      author: payload.author,
      avatar: "\uD83E\uDD16",
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
      nostrPubkey: senderPk,
    };

    this.callbacks.onNewContent(item);
    this.receivedItems++;

    const handshake = this.handshakes.get(senderPk);
    if (handshake) {
      handshake.phase = "completed";
      handshake.completedAt = Date.now();
    }

    if (this.callbacks.onD2AMatchComplete && fee > 0) {
      const contentHash = bytesToHex(sha256(new TextEncoder().encode(payload.text)));
      try {
        await this.callbacks.onD2AMatchComplete(senderPk, peerProfile.principalId, contentHash, fee);
        this.d2aMatchCount++;
      } catch (err) {
        console.warn("[agent] onD2AMatchComplete callback failed:", errMsg(err));
      }
    }

    this.emitState();
  }
}
