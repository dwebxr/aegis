/**
 * Per-instance daily budget for expensive API calls (e.g. Anthropic).
 * Prevents runaway costs if rate limiting is bypassed across serverless instances.
 *
 * LIMITATION: Like rateLimit, this is per-instance on Vercel serverless.
 * Each warm instance tracks its own counter independently.
 * For stronger guarantees, migrate to Vercel KV or Redis.
 */

const DAILY_BUDGET = parseInt(process.env.ANTHROPIC_DAILY_BUDGET || "500", 10);
let dailyApiCalls = 0;
let dailyResetAt = Date.now() + 86_400_000;

/** Returns true if within the daily budget. */
export function withinDailyBudget(): boolean {
  const now = Date.now();
  if (now >= dailyResetAt) {
    dailyApiCalls = 0;
    dailyResetAt = now + 86_400_000;
  }
  return dailyApiCalls < DAILY_BUDGET;
}

/** Increment the daily call counter. Call after a successful API request. */
export function recordApiCall(): void {
  dailyApiCalls++;
}

/** Reset daily budget counter (for testing only). */
export function _resetDailyBudget(): void {
  dailyApiCalls = 0;
  dailyResetAt = Date.now() + 86_400_000;
}
