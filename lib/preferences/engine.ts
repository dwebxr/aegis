import type {
  UserPreferenceProfile,
  UserContext,
  AuthorTrust,
} from "./types";
import {
  RECENT_TOPICS_MAX,
  TOPIC_AFFINITY_CAP,
  TOPIC_AFFINITY_FLOOR,
  AUTHOR_TRUST_CAP,
  AUTHOR_TRUST_FLOOR,
} from "./types";
import { clamp } from "@/lib/utils/math";

interface LearnEvent {
  action: "validate" | "flag";
  topics: string[];
  author: string;
  composite: number;
  verdict: "quality" | "slop";
}

const VALIDATE_TOPIC_DELTA = 0.1;
const FLAG_TOPIC_DELTA = -0.05;
const VALIDATE_AUTHOR_DELTA = 0.2;
const FLAG_AUTHOR_DELTA = -0.3;
const THRESHOLD_LOWER = -0.05; // borderline validate → lower threshold
const THRESHOLD_RAISE = 0.1;   // quality-judged item flagged → raise threshold
const BORDERLINE_LOW = 3.5;
const BORDERLINE_HIGH = 4.5;

export function learn(profile: UserPreferenceProfile, event: LearnEvent): UserPreferenceProfile {
  const next = structuredClone(profile);
  const now = Date.now();

  const topicDelta = event.action === "validate" ? VALIDATE_TOPIC_DELTA : FLAG_TOPIC_DELTA;
  for (const topic of event.topics) {
    const current = next.topicAffinities[topic] ?? 0;
    next.topicAffinities[topic] = clamp(current + topicDelta, TOPIC_AFFINITY_FLOOR, TOPIC_AFFINITY_CAP);
  }

  if (event.author) {
    const existing: AuthorTrust = next.authorTrust[event.author] ?? { validates: 0, flags: 0, trust: 0 };
    if (event.action === "validate") {
      existing.validates += 1;
      existing.trust = clamp(existing.trust + VALIDATE_AUTHOR_DELTA, AUTHOR_TRUST_FLOOR, AUTHOR_TRUST_CAP);
    } else {
      existing.flags += 1;
      existing.trust = clamp(existing.trust + FLAG_AUTHOR_DELTA, AUTHOR_TRUST_FLOOR, AUTHOR_TRUST_CAP);
    }
    next.authorTrust[event.author] = existing;
  }

  if (event.action === "validate" && event.composite >= BORDERLINE_LOW && event.composite <= BORDERLINE_HIGH) {
    next.calibration.qualityThreshold = Math.max(1, next.calibration.qualityThreshold + THRESHOLD_LOWER);
  }
  if (event.action === "flag" && event.verdict === "quality") {
    next.calibration.qualityThreshold = Math.min(9, next.calibration.qualityThreshold + THRESHOLD_RAISE);
  }

  if (event.action === "validate") {
    next.totalValidated += 1;
  } else {
    next.totalFlagged += 1;
  }

  for (const topic of event.topics) {
    next.recentTopics.push({ topic, timestamp: now, weight: 1 });
  }
  if (next.recentTopics.length > RECENT_TOPICS_MAX) {
    next.recentTopics = next.recentTopics
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, RECENT_TOPICS_MAX);
  }

  next.lastUpdated = now;
  return next;
}

export function getContext(profile: UserPreferenceProfile): UserContext {
  const HIGH_THRESHOLD = 0.3;
  const LOW_THRESHOLD = -0.2;
  const TRUST_THRESHOLD = 0.3;

  const highAffinityTopics = Object.entries(profile.topicAffinities)
    .filter(([, v]) => v >= HIGH_THRESHOLD)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([k]) => k);

  const lowAffinityTopics = Object.entries(profile.topicAffinities)
    .filter(([, v]) => v <= LOW_THRESHOLD)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 5)
    .map(([k]) => k);

  const trustedAuthors = Object.entries(profile.authorTrust)
    .filter(([, v]) => v.trust >= TRUST_THRESHOLD)
    .sort(([, a], [, b]) => b.trust - a.trust)
    .slice(0, 10)
    .map(([k]) => k);

  const seen = new Set<string>();
  const recentTopics: string[] = [];
  for (const rt of [...profile.recentTopics].sort((a, b) => b.timestamp - a.timestamp)) {
    if (!seen.has(rt.topic)) {
      seen.add(rt.topic);
      recentTopics.push(rt.topic);
      if (recentTopics.length >= 10) break;
    }
  }

  return { highAffinityTopics, lowAffinityTopics, trustedAuthors, recentTopics };
}

export function hasEnoughData(profile: UserPreferenceProfile): boolean {
  return profile.totalValidated + profile.totalFlagged >= 3;
}
