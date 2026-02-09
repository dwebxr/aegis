export interface AgentProfile {
  nostrPubkey: string;
  principalId?: string; // IC principal text, included in presence broadcast
  interests: string[];
  capacity: number; // how many items this agent can accept per cycle
  lastSeen: number;
  resonance?: number; // computed locally against our profile
}

export type HandshakePhase = "idle" | "offered" | "accepted" | "delivering" | "completed" | "rejected";

export interface HandshakeState {
  peerId: string; // nostr pubkey of peer
  phase: HandshakePhase;
  offeredTopic: string;
  offeredScore: number;
  startedAt: number;
  completedAt?: number;
}

export interface D2AMessage {
  type: "offer" | "accept" | "reject" | "deliver";
  fromPubkey: string;
  toPubkey: string;
  payload: D2AOfferPayload | D2ADeliverPayload | Record<string, never>;
}

export interface D2AOfferPayload {
  topic: string;
  score: number;
  contentPreview: string; // first 100 chars
}

export interface D2ADeliverPayload {
  text: string;
  author: string;
  scores: {
    originality: number;
    insight: number;
    credibility: number;
    composite: number;
  };
  verdict: "quality" | "slop";
  topics: string[];
  vSignal?: number;
  cContext?: number;
  lSlop?: number;
}

export interface AgentState {
  isActive: boolean;
  myPubkey: string | null;
  peers: AgentProfile[];
  activeHandshakes: HandshakeState[];
  receivedItems: number;
  sentItems: number;
  d2aMatchCount: number;
  consecutiveErrors: number; // relay/discovery failures since last success
  lastError?: string;        // most recent error message
}
