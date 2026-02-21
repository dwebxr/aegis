/**
 * Per-instance daily budget for expensive API calls (e.g. Anthropic).
 * NOTE: On Vercel serverless, state is per-instance and resets on cold start.
 * This provides burst protection within a single warm instance only —
 * concurrent instances each get their own budget. For stronger guarantees,
 * migrate to Vercel KV or Redis.
 */

const DAILY_BUDGET = parseInt((process.env.ANTHROPIC_DAILY_BUDGET || "500").trim(), 10);
let dailyApiCalls = 0;
let dailyResetAt = Date.now() + 86_400_000;

export function withinDailyBudget(): boolean {
  const now = Date.now();
  if (now >= dailyResetAt) {
    dailyApiCalls = 0;
    dailyResetAt = now + 86_400_000;
  }
  return dailyApiCalls < DAILY_BUDGET;
}

export function recordApiCall(): void {
  dailyApiCalls++;
  const threshold = Math.floor(DAILY_BUDGET * 0.1);
  if (threshold > 0 && dailyApiCalls === DAILY_BUDGET - threshold) {
    console.warn(`[dailyBudget] 90% consumed: ${dailyApiCalls}/${DAILY_BUDGET} calls used`);
  }
}

export function _resetDailyBudget(): void {
  dailyApiCalls = 0;
  dailyResetAt = Date.now() + 86_400_000;
}
