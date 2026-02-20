/**
 * Shared V/C/L scoring prompt used by all AI scoring tiers (Ollama, WebLLM, Claude).
 */
export function buildScoringPrompt(
  text: string,
  userTopics?: string[],
  maxContentLength = 3000,
): string {
  const contentSlice = text.slice(0, maxContentLength);
  const topics = userTopics && userTopics.length > 0 ? userTopics : [];
  const topicsStr = topics.length > 0 ? topics.join(", ") : "general";

  return `You are the Aegis Slop Incinerator AI. Evaluate this content using the V/C/L framework.

User interests: ${topicsStr}

Score each dimension 0-10:
- vSignal: Information density & novelty. Does this contain genuinely new information, data, or analysis?
- cContext: Relevance to user interests listed above. How well does this match what they care about?
- lSlop: Clickbait, engagement farming, rehashed content, empty opinions. Higher = more slop.

Also score the legacy axes:
- originality (0-10): Novel or rehashed?
- insight (0-10): Deep analysis or surface-level?
- credibility (0-10): Reliable sourcing?

Topics: Extract 1-3 topic tags that describe the PRIMARY subject of this article (lowercase, short phrases). Only include topics the article is fundamentally ABOUT — not topics it merely mentions or references in passing. Do NOT copy from the user interests above; derive topics solely from the article content.

Composite score: S = (vSignal * cContext) / (lSlop + 0.5), then normalize to 0-10 scale.
Verdict: "quality" if composite >= 4, else "slop".

Content: "${contentSlice}"

Respond ONLY in this exact JSON format:
{"vSignal":N,"cContext":N,"lSlop":N,"originality":N,"insight":N,"credibility":N,"composite":N.N,"verdict":"quality"|"slop","reason":"brief explanation","topics":["tag1","tag2"]}`;
}
