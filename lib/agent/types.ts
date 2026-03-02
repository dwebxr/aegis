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

interface D2AMessageBase {
  fromPubkey: string;
  toPubkey: string;
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

export interface D2ACommentPayload {
  contentHash: string;
  contentTitle: string;
  comment: string;
  timestamp: number;
}

export interface D2ACommentMessage extends D2AMessageBase {
  type: "comment";
  payload: D2ACommentPayload;
}

export type D2AMessage = D2AOfferMessage | D2AAcceptMessage | D2ARejectMessage | D2ADeliverMessage | D2ACommentMessage;

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

export type ActivityLogType =
  | "presence" | "discovery" | "offer_sent" | "offer_received"
  | "accept" | "reject" | "deliver" | "received" | "error"
  | "comment_sent" | "comment_received";

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  type: ActivityLogType;
  message: string;
  peerId?: string;
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
  activityLog: ActivityLogEntry[];
}
