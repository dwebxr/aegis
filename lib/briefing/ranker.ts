import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { BriefingState, BriefingItem } from "./types";

const PRIORITY_COUNT = 5;
const RECENCY_HALF_LIFE_HOURS = 7;

function briefingScore(item: ContentItem, prefs: UserPreferenceProfile, now?: number): number {
  const baseScore = item.scores.composite;

  const topicRelevance = item.topics?.reduce((sum, t) =>
    sum + (prefs.topicAffinities[t] || 0), 0) || 0;

  const authorBoost = prefs.authorTrust[item.author]?.trust || 0;

  const ageHours = ((now ?? Date.now()) - item.createdAt) / 3600000;
  // Decay factor: ln(2)/RECENCY_HALF_LIFE_HOURS gives true half-life at RECENCY_HALF_LIFE_HOURS
  const decayRate = Math.LN2 / RECENCY_HALF_LIFE_HOURS;
  const recencyFactor = Math.exp(-decayRate * ageHours);

  return (baseScore + topicRelevance * 2 + authorBoost) * recencyFactor;
}

function serendipityScore(item: ContentItem, prefs: UserPreferenceProfile): number {
  // High V_signal + low C_context = content outside user's bubble but still valuable
  const vSignal = item.vSignal ?? item.scores.composite;
  const cContext = item.cContext ?? 5;

  // Novelty: topics user has NOT seen or has low affinity for
  const topicNovelty = item.topics?.reduce((sum, t) => {
    const affinity = prefs.topicAffinities[t] ?? 0;
    // Lower affinity = more novel for this user
    return sum + Math.max(0, 0.5 - affinity);
  }, 0) || 0;

  const noveltyBonus = Math.max(0, 10 - cContext);
  return vSignal * 0.5 + noveltyBonus * 0.3 + topicNovelty * 0.2;
}

export function generateBriefing(
  content: ContentItem[],
  prefs: UserPreferenceProfile,
  now?: number,
): BriefingState {
  const threshold = prefs.calibration.qualityThreshold;
  const qualityItems = content.filter(c =>
    c.verdict === "quality" && !c.flagged && c.scores.composite >= threshold,
  );

  const scored: Array<{ item: ContentItem; score: number }> = qualityItems.map(item => ({
    item,
    score: briefingScore(item, prefs, now),
  }));
  scored.sort((a, b) => b.score - a.score);

  const priorityItems = scored.slice(0, PRIORITY_COUNT);
  const priorityIds = new Set(priorityItems.map(s => s.item.id));

  const remainingQuality = scored.filter(s => !priorityIds.has(s.item.id));
  let serendipity: BriefingItem | null = null;

  if (remainingQuality.length > 0) {
    const serendipityCandidates = remainingQuality.map(s => ({
      item: s.item,
      score: serendipityScore(s.item, prefs),
    }));
    serendipityCandidates.sort((a, b) => b.score - a.score);
    const best = serendipityCandidates[0];
    serendipity = {
      item: best.item,
      briefingScore: best.score,
      isSerendipity: true,
    };
  }

  const selectedIds = new Set(priorityIds);
  if (serendipity) selectedIds.add(serendipity.item.id);

  const filteredOut = content.filter(c => !selectedIds.has(c.id));

  return {
    priority: priorityItems.map(s => ({
      item: s.item,
      briefingScore: s.score,
      isSerendipity: false,
    })),
    serendipity,
    filteredOut,
    totalItems: content.length,
    generatedAt: Date.now(),
  };
}
