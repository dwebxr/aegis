import type { ScoreParseResult } from "./types";
import { clamp } from "@/lib/utils/math";

export function enforceScoreInvariants(r: ScoreParseResult): ScoreParseResult {
  const composite = clamp((r.vSignal * r.cContext) / (r.lSlop + 0.5), 0, 10);
  return {
    ...r,
    composite,
    verdict: composite >= 4 ? "quality" : "slop",
  };
}
