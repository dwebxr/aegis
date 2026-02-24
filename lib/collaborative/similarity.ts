/**
 * Collaborative filtering: compute user similarity from topic affinity vectors
 * and recommend items from similar users' briefings.
 *
 * Uses cosine similarity on topic affinity vectors. Users who share many
 * high-affinity topics are considered similar. Items from similar users'
 * briefings that the current user hasn't seen are recommended.
 */

import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { GlobalBriefingContributor } from "@/lib/d2a/briefingProvider";

export interface SimilarUser {
  principal: string;
  similarity: number; // 0-1
  sharedTopics: string[];
}

export interface CommunityPick {
  title: string;
  topics: string[];
  briefingScore: number;
  verdict: "quality" | "slop";
  fromPrincipal: string;
  similarity: number;
  /** Weighted score: briefingScore * similarity */
  cfScore: number;
}

/**
 * Compute cosine similarity between the current user's topic affinities
 * and a contributor's briefing topics.
 *
 * The contributor's "profile" is inferred from their briefing items' topics:
 * each topic in their briefing gets weight 1, normalized by vector magnitude.
 */
export function computeTopicSimilarity(
  userAffinities: Record<string, number>,
  contributorTopics: string[],
): { similarity: number; sharedTopics: string[] } {
  if (contributorTopics.length === 0) return { similarity: 0, sharedTopics: [] };

  // Build contributor topic frequency vector
  const contribVector = new Map<string, number>();
  for (const topic of contributorTopics) {
    const t = topic.toLowerCase();
    contribVector.set(t, (contribVector.get(t) || 0) + 1);
  }

  // Cosine similarity: only need to iterate each vector once.
  // Dot product only has non-zero terms where both vectors are non-zero,
  // so iterate user keys (checking contrib) for dot product + user magnitude,
  // then iterate contrib keys for contrib magnitude.
  let dotProduct = 0;
  let userMagnitude = 0;
  let contribMagnitude = 0;
  const sharedTopics: string[] = [];

  for (const topic of Object.keys(userAffinities)) {
    const userPos = Math.max(0, userAffinities[topic]);
    userMagnitude += userPos * userPos;
    const contribVal = contribVector.get(topic) ?? 0;
    if (userPos > 0 && contribVal > 0) {
      dotProduct += userPos * contribVal;
      sharedTopics.push(topic);
    }
  }

  contribVector.forEach(val => { contribMagnitude += val * val; });

  const magnitude = Math.sqrt(userMagnitude) * Math.sqrt(contribMagnitude);
  return { similarity: magnitude > 0 ? dotProduct / magnitude : 0, sharedTopics };
}

/**
 * Find similar users from global briefing contributors.
 * Returns users sorted by similarity (descending), filtered by minimum threshold.
 */
export function findSimilarUsers(
  profile: UserPreferenceProfile,
  contributors: GlobalBriefingContributor[],
  minSimilarity = 0.1,
): SimilarUser[] {
  const results: SimilarUser[] = [];

  for (const contributor of contributors) {
    // Skip self
    if (contributor.principal === profile.principalId) continue;

    // Collect all topics from the contributor's briefing items
    const allTopics = contributor.topItems.flatMap(item => item.topics);

    const { similarity, sharedTopics } = computeTopicSimilarity(
      profile.topicAffinities,
      allTopics,
    );

    if (similarity >= minSimilarity) {
      results.push({
        principal: contributor.principal,
        similarity,
        sharedTopics,
      });
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Generate community picks by finding quality items from similar users'
 * briefings that the current user likely hasn't seen.
 *
 * Items are scored by: briefingScore * similarity, giving preference
 * to high-quality items from highly similar users.
 */
export function generateCommunityPicks(
  profile: UserPreferenceProfile,
  contributors: GlobalBriefingContributor[],
  maxPicks = 5,
): CommunityPick[] {
  const similarUsers = findSimilarUsers(profile, contributors);
  if (similarUsers.length === 0) return [];

  const similarityMap = new Map(similarUsers.map(u => [u.principal, u.similarity]));
  const picks: CommunityPick[] = [];
  const seenTitles = new Set<string>();

  for (const contributor of contributors) {
    const similarity = similarityMap.get(contributor.principal);
    if (!similarity) continue;

    for (const item of contributor.topItems) {
      if (item.verdict !== "quality") continue;
      if (seenTitles.has(item.title.toLowerCase())) continue;

      seenTitles.add(item.title.toLowerCase());
      picks.push({
        title: item.title,
        topics: item.topics,
        briefingScore: item.briefingScore,
        verdict: item.verdict,
        fromPrincipal: contributor.principal,
        similarity,
        cfScore: item.briefingScore * similarity,
      });
    }
  }

  return picks
    .sort((a, b) => b.cfScore - a.cfScore)
    .slice(0, maxPicks);
}
