/**
 * Wire types for D2A v1.0 messages, manifests, and discovery.
 * Matches the schema documented in docs/D2A_PROTOCOL.md.
 */

export type Verdict = "quality" | "slop";

export interface ScoreBreakdown {
  originality: number;
  insight: number;
  credibility: number;
  composite: number;
}

export interface ManifestEntry {
  hash: string;
  topic: string;
  score: number;
}

export interface ContentManifest {
  entries: ManifestEntry[];
  /** Unix epoch in milliseconds. */
  generatedAt: number;
}

export interface AgentProfile {
  nostrPubkey: string;
  /** Optional advisory binding to an Internet Computer principal. */
  principalId?: string;
  interests: string[];
  capacity: number;
  /** Unix epoch in milliseconds. */
  lastSeen: number;
  /** Filled in by `discoverPeers` after Jaccard similarity calc. */
  resonance?: number;
  manifest?: ContentManifest;
}

export type HandshakePhase =
  | "offered"
  | "accepted"
  | "delivering"
  | "completed"
  | "rejected";

export interface HandshakeState {
  peerId: string;
  phase: HandshakePhase;
  offeredTopic: string;
  offeredScore: number;
  /** Unix epoch in milliseconds. */
  startedAt: number;
  /** Unix epoch in milliseconds; populated on `completed`. */
  completedAt?: number;
}

interface D2AMessageBase {
  fromPubkey: string;
  toPubkey: string;
}

export interface D2AOfferPayload {
  topic: string;
  score: number;
  contentPreview: string;
}

export interface D2ADeliverPayload {
  text: string;
  author: string;
  scores: ScoreBreakdown;
  verdict: Verdict;
  topics: string[];
  vSignal?: number;
  cContext?: number;
  lSlop?: number;
}

export interface D2ACommentPayload {
  contentHash: string;
  contentTitle: string;
  comment: string;
  /** Unix epoch in milliseconds. */
  timestamp: number;
}

export interface D2AOfferMessage extends D2AMessageBase {
  type: "offer";
  payload: D2AOfferPayload;
}
export interface D2AAcceptMessage extends D2AMessageBase {
  type: "accept";
  payload: Record<string, never>;
}
export interface D2ARejectMessage extends D2AMessageBase {
  type: "reject";
  payload: Record<string, never>;
}
export interface D2ADeliverMessage extends D2AMessageBase {
  type: "deliver";
  payload: D2ADeliverPayload;
}
export interface D2ACommentMessage extends D2AMessageBase {
  type: "comment";
  payload: D2ACommentPayload;
}

export type D2AMessage =
  | D2AOfferMessage
  | D2AAcceptMessage
  | D2ARejectMessage
  | D2ADeliverMessage
  | D2ACommentMessage;

/**
 * Minimal preference shape required by `calculateResonance`. Consumers can
 * pass any object with a string→number affinity map; the SDK avoids importing
 * the full Aegis preference profile to keep the surface small.
 */
export interface ResonancePrefs {
  topicAffinities: Record<string, number>;
}
