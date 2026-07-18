import "server-only";
import type { UserContext } from "@/lib/preferences/types";
import { callAnthropic, ANTHROPIC_DEFAULT_MODEL } from "@/lib/api/anthropic";
import { parseScoreResponse } from "./parseResponse";
import { buildScoringPrompt } from "./prompt";
import type { ScoreParseResult } from "./types";

export async function scoreOneText(
  text: string,
  userContext: UserContext | undefined,
  apiKey: string,
  options?: { timeoutMs?: number; untrustedNotice?: boolean },
): Promise<ScoreParseResult & { tier: "claude" }> {
  const allTopics = userContext
    ? [...userContext.recentTopics, ...userContext.highAffinityTopics].filter(Boolean)
    : [];
  const prompt = buildScoringPrompt(
    text,
    allTopics.length > 0 ? allTopics : undefined,
    5000,
    options?.untrustedNotice ?? false,
  );

  const res = await callAnthropic({
    apiKey,
    model: ANTHROPIC_DEFAULT_MODEL,
    maxTokens: 1000,
    messages: [{ role: "user", content: prompt }],
    timeoutMs: options?.timeoutMs ?? 15_000,
  });

  if (!res.ok) throw new Error(`Anthropic API returned ${res.status}`);

  const parsed = parseScoreResponse(res.text);
  if (!parsed) throw new Error("Failed to parse AI response");

  return { ...parsed, tier: "claude" as const };
}
