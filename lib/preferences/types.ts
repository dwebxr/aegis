export interface AuthorTrust {
  validates: number;
  flags: number;
  trust: number; // [-1, 1]
}

export interface RecentTopic {
  topic: string;
  timestamp: number;
}

export interface ScoringCalibration {
  qualityThreshold: number;
}

export interface UserPreferenceProfile {
  version: 1;
  principalId: string;
  topicAffinities: Record<string, number>; // topic → [-1, 1]
  authorTrust: Record<string, AuthorTrust>;
  calibration: ScoringCalibration;
  recentTopics: RecentTopic[];
  totalValidated: number;
  totalFlagged: number;
  lastUpdated: number;
}

export interface UserContext {
  highAffinityTopics: string[];
  lowAffinityTopics: string[];
  trustedAuthors: string[];
  recentTopics: string[];
}

export const DEFAULT_CALIBRATION: ScoringCalibration = {
  qualityThreshold: 4.0,
};

export const RECENT_TOPICS_MAX = 50;
export const TOPIC_AFFINITY_CAP = 1.0;
export const TOPIC_AFFINITY_FLOOR = -1.0;
export const AUTHOR_TRUST_CAP = 1.0;
export const AUTHOR_TRUST_FLOOR = -1.0;

export function createEmptyProfile(principalId: string): UserPreferenceProfile {
  return {
    version: 1,
    principalId,
    topicAffinities: {},
    authorTrust: {},
    calibration: { ...DEFAULT_CALIBRATION },
    recentTopics: [],
    totalValidated: 0,
    totalFlagged: 0,
    lastUpdated: Date.now(),
  };
}
