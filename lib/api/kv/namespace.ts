import { kvNamespace } from "./internal/factory";

export const rateLimitKV = kvNamespace("aegis:rl:");
export const dailyBudgetKV = kvNamespace("aegis:api-calls:");
export const scoreBudgetKV = kvNamespace("aegis:score-calls:");
export const scoreCacheKV = kvNamespace("aegis:score:");
export const metricsKV = kvNamespace("aegis:metrics:");
