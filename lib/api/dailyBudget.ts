/**
 * Per-instance daily budget for expensive API calls (e.g. Anthropic).
 * Prevents runaway costs if rate limiting is bypassed across serverless instances.
 */

const DAILY_BUDGET = parseInt(process.env.ANTHROPIC_DAILY_BUDGET || "500", 10);
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
}

export function _resetDailyBudget(): void {
  dailyApiCalls = 0;
  dailyResetAt = Date.now() + 86_400_000;
}
