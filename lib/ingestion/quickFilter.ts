/**
 * Heuristic text-quality scoring (no API call needed).
 * Used as fallback in /api/analyze and as pre-filter in ingestion.
 */

export interface HeuristicScores {
  originality: number;
  insight: number;
  credibility: number;
  composite: number;
  verdict: "quality" | "slop";
  reason: string;
}

export function heuristicScores(text: string): HeuristicScores {
  const words = text.split(/\s+/).length;
  const exclamationDensity = (text.match(/!/g) || []).length / Math.max(words, 1);
  const emojiRegex = new RegExp("[\\u{1F600}-\\u{1F6FF}\\u{1F900}-\\u{1F9FF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}]", "gu");
  const emojiDensity = (text.match(emojiRegex) || []).length / Math.max(words, 1);
  const capsRatio = (text.match(/[A-Z]/g) || []).length / Math.max(text.length, 1);
  const hasLinks = /https?:\/\//.test(text);
  const hasData = /\d+%|\$\d|[0-9]+\.[0-9]/.test(text);

  let originality = 5;
  let insight = 5;
  let credibility = 5;

  const signals: string[] = [];
  // Negative signals
  if (exclamationDensity > 0.1) { originality -= 3; credibility -= 3; signals.push("excessive exclamation marks"); }
  if (emojiDensity > 0.05) { originality -= 2; signals.push("high emoji density"); }
  if (capsRatio > 0.3) { credibility -= 3; originality -= 2; signals.push("excessive caps"); }
  if (words < 8) { insight -= 1; originality -= 1; signals.push("very short content"); }
  // Positive signals
  if (words > 50) { insight += 1; }
  if (words > 100) { insight += 1; originality += 1; signals.push("long-form content"); }
  if (words > 200) { insight += 1; signals.push("detailed content"); }
  if (hasLinks) { credibility += 2; signals.push("contains links"); }
  if (hasData) { insight += 2; credibility += 1; signals.push("contains data/numbers"); }
  // Structure signals
  const paragraphs = text.split(/\n\s*\n/).length;
  if (paragraphs >= 3) { originality += 1; insight += 1; signals.push("structured paragraphs"); }
  // Analytical language
  if (/\b(analysis|evidence|hypothesis|correlation|framework|methodology|dataset|benchmark|implementation|algorithm)\b/i.test(text)) {
    insight += 1; credibility += 1; signals.push("analytical language");
  }
  // Attribution
  if (/\b(according to|cited|source:)\b/i.test(text)) {
    credibility += 2; signals.push("attribution present");
  }

  originality = Math.max(0, Math.min(10, originality));
  insight = Math.max(0, Math.min(10, insight));
  credibility = Math.max(0, Math.min(10, credibility));

  const composite = parseFloat((originality * 0.4 + insight * 0.35 + credibility * 0.25).toFixed(1));
  const reason = signals.length > 0
    ? `Heuristic (AI unavailable): ${signals.join(", ")}.`
    : "Heuristic (AI unavailable): no strong signals detected.";
  return {
    originality, insight, credibility, composite,
    verdict: composite >= 4 ? "quality" : "slop",
    reason,
  };
}

/**
 * Quick slop filter — returns true if content passes (likely not slop).
 */
export function quickSlopFilter(text: string, threshold: number = 3.5): boolean {
  return heuristicScores(text).composite >= threshold;
}
