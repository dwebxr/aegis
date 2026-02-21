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
  imageUrl: [] | [string];
  scores: ScoreBreakdown;
  verdict: Verdict;
  reason: string;
  createdAt: bigint;
  validated: boolean;
  flagged: boolean;
  validatedAt: [] | [bigint];
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

export type StakeStatus =
  | { active: null }
  | { returned: null }
  | { slashed: null };

export interface StakeRecord {
  id: string;
  owner: Principal;
  signalId: string;
  amount: bigint;
  status: StakeStatus;
  validationCount: bigint;
  flagCount: bigint;
  createdAt: bigint;
  resolvedAt: [] | [bigint];
}

export interface UserReputation {
  principal: Principal;
  trustScore: number;
  totalStaked: bigint;
  totalReturned: bigint;
  totalSlashed: bigint;
  qualitySignals: bigint;
  slopSignals: bigint;
}

export interface D2AMatchRecord {
  id: string;
  senderPrincipal: Principal;
  receiverPrincipal: Principal;
  contentHash: string;
  feeAmount: bigint;
  senderPayout: bigint;
  protocolPayout: bigint;
  createdAt: bigint;
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
  createdAt: bigint;
}

export type AnalysisTier = { free: null } | { premium: null };

export interface OnChainAnalysis {
  originality: number;
  insight: number;
  credibility: number;
  compositeScore: number;
  verdict: Verdict;
  reason: string;
  topics: string[];
  tier: AnalysisTier;
  vSignal: [] | [number];
  cContext: [] | [number];
  lSlop: [] | [number];
}

export interface UserSettings {
  linkedNostrNpub: [] | [string];
  linkedNostrPubkeyHex: [] | [string];
  d2aEnabled: boolean;
  updatedAt: bigint;
}

export interface UserPreferences {
  owner: Principal;
  preferencesJson: string;
  lastUpdated: bigint;
  savedAt: bigint;
}

export interface GlobalBriefingSummariesResult {
  items: Array<[Principal, string, bigint]>;
  total: bigint;
}

export type Result<T, E> = { ok: T } | { err: E };

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
  publishWithStake: ActorMethod<[PublishedSignal, bigint], Result<string, string>>;
  validateSignal: ActorMethod<[string], Result<boolean, string>>;
  flagSignal: ActorMethod<[string], Result<boolean, string>>;
  getUserReputation: ActorMethod<[Principal], UserReputation>;
  getSignalStake: ActorMethod<[string], [] | [StakeRecord]>;
  recordD2AMatch: ActorMethod<[string, Principal, string, bigint], Result<string, string>>;
  getUserD2AMatches: ActorMethod<[Principal, bigint, bigint], D2AMatchRecord[]>;
  getEngagementIndex: ActorMethod<[Principal], number>;
  getTreasuryBalance: ActorMethod<[], bigint>;
  sweepProtocolFees: ActorMethod<[], Result<string, string>>;
  topUpCycles: ActorMethod<[], Result<string, string>>;
  analyzeOnChain: ActorMethod<[string, string[]], Result<OnChainAnalysis, string>>;
  registerPushSubscription: ActorMethod<[string, string, string], boolean>;
  unregisterPushSubscription: ActorMethod<[string], boolean>;
  getPushSubscriptions: ActorMethod<[Principal], PushSubscription[]>;
  removePushSubscriptions: ActorMethod<[Principal, string[]], boolean>;
  getPushSubscriptionCount: ActorMethod<[], bigint>;
  saveLatestBriefing: ActorMethod<[string], boolean>;
  getLatestBriefing: ActorMethod<[Principal], [] | [string]>;
  getGlobalBriefingSummaries: ActorMethod<[bigint, bigint], GlobalBriefingSummariesResult>;
  getUserSettings: ActorMethod<[Principal], [] | [UserSettings]>;
  saveUserSettings: ActorMethod<[UserSettings], boolean>;
  getUserPreferences: ActorMethod<[Principal], [] | [UserPreferences]>;
  saveUserPreferences: ActorMethod<[string, bigint], boolean>;
}
