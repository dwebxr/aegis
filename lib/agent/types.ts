import type { ContentManifest } from "@/lib/d2a/manifest";
import type { ScoreBreakdown, Verdict } from "@/lib/types/content";

export interface AgentProfile {
  nostrPubkey: string;
  principalId?: string;
  interests: string[];
  capacity: number;
  lastSeen: number;
  resonance?: number;
  manifest?: ContentManifest;
}

export type HandshakePhase = "offered" | "accepted" | "delivering" | "completed" | "rejected";

export interface HandshakeState {
  peerId: string;
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

export interface AgentState {
  isActive: boolean;
  myPubkey: string | null;
  peers: AgentProfile[];
  activeHandshakes: HandshakeState[];
  receivedItems: number;
  sentItems: number;
  d2aMatchCount: number;
  consecutiveErrors: number;
  lastError?: string;
}
