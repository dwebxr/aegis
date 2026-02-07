import type { Principal } from "@dfinity/principal";
import type { ActorMethod } from "@dfinity/agent";

export type Verdict = { quality: null } | { slop: null };
export type ContentSource =
  | { manual: null }
  | { rss: null }
  | { url: null }
  | { twitter: null }
  | { nostr: null };

export interface ScoreBreakdown {
  originality: number;
  insight: number;
  credibility: number;
  compositeScore: number;
}

export interface ContentEvaluation {
  id: string;
  owner: Principal;
  author: string;
  avatar: string;
  text: string;
  source: ContentSource;
  sourceUrl: [] | [string];
  scores: ScoreBreakdown;
  verdict: Verdict;
  reason: string;
  createdAt: bigint;
  validated: boolean;
  flagged: boolean;
}

export interface UserProfile {
  principal: Principal;
  displayName: [] | [string];
  createdAt: bigint;
  totalEvaluations: bigint;
  totalQuality: bigint;
  totalSlop: bigint;
}

export interface AnalyticsResult {
  totalEvaluations: bigint;
  totalQuality: bigint;
  totalSlop: bigint;
  averageComposite: number;
  recentCount7d: bigint;
}

export interface SourceConfigEntry {
  id: string;
  owner: Principal;
  sourceType: string;
  configJson: string;
  enabled: boolean;
  createdAt: bigint;
}

export interface PublishedSignal {
  id: string;
  owner: Principal;
  text: string;
  nostrEventId: [] | [string];
  nostrPubkey: [] | [string];
  scores: ScoreBreakdown;
  verdict: Verdict;
  topics: string[];
  createdAt: bigint;
}

export interface _SERVICE {
  getProfile: ActorMethod<[Principal], [] | [UserProfile]>;
  getEvaluation: ActorMethod<[string], [] | [ContentEvaluation]>;
  getUserEvaluations: ActorMethod<[Principal, bigint, bigint], ContentEvaluation[]>;
  getUserAnalytics: ActorMethod<[Principal], AnalyticsResult>;
  getUserSourceConfigs: ActorMethod<[Principal], SourceConfigEntry[]>;
  getUserSignals: ActorMethod<[Principal, bigint, bigint], PublishedSignal[]>;
  saveEvaluation: ActorMethod<[ContentEvaluation], string>;
  updateEvaluation: ActorMethod<[string, boolean, boolean], boolean>;
  batchSaveEvaluations: ActorMethod<[ContentEvaluation[]], bigint>;
  updateDisplayName: ActorMethod<[string], boolean>;
  saveSourceConfig: ActorMethod<[SourceConfigEntry], string>;
  deleteSourceConfig: ActorMethod<[string], boolean>;
  saveSignal: ActorMethod<[PublishedSignal], string>;
}
