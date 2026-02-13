export interface DailyCostRecord {
  date: string;
  articlesEvaluated: number;
  articlesPassedWoT: number;
  articlesPassedAI: number;
  discoveriesFound: number;
  aiCostUSD: number;
}

export interface MonthlyCostSummary {
  month: string;
  totalEvaluated: number;
  totalPassedWoT: number;
  totalPassedAI: number;
  totalDiscoveries: number;
  totalAiCostUSD: number;
  totalDays: number;
  timeSavedMinutes: number;
  timeSavedFormatted: string;
}

// Estimated reading/evaluation time saved per filtered article (industry avg: 2-5 min per article)
export const SCROLL_TIME_SAVED_PER_ITEM_MIN = 3;

const STORAGE_KEY = "aegis-cost-tracker";
const MAX_DAYS = 90;

function loadRecords(): Record<string, DailyCostRecord> {
  if (typeof globalThis.localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, DailyCostRecord>;
  } catch {
    return {};
  }
}

function saveRecords(records: Record<string, DailyCostRecord>): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    const keys = Object.keys(records).sort();
    const pruned = keys.length > MAX_DAYS
      ? Object.fromEntries(keys.slice(-MAX_DAYS).map(k => [k, records[k]]))
      : records;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // localStorage quota exceeded
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function recordFilterRun(data: {
  articlesEvaluated: number;
  wotScoredCount: number;
  aiScoredCount: number;
  discoveriesFound: number;
  aiCostUSD: number;
}): void {
  const records = loadRecords();
  const key = todayKey();
  const existing = records[key] || {
    date: key,
    articlesEvaluated: 0,
    articlesPassedWoT: 0,
    articlesPassedAI: 0,
    discoveriesFound: 0,
    aiCostUSD: 0,
  };

  existing.articlesEvaluated += data.articlesEvaluated;
  existing.articlesPassedWoT += data.wotScoredCount;
  existing.articlesPassedAI += data.aiScoredCount;
  existing.discoveriesFound += data.discoveriesFound;
  existing.aiCostUSD += data.aiCostUSD;

  records[key] = existing;
  saveRecords(records);
}

export function getDailyCost(date?: string): DailyCostRecord | null {
  const records = loadRecords();
  const key = date || todayKey();
  return records[key] || null;
}

export function getMonthlyCost(month?: string): MonthlyCostSummary {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  const records = loadRecords();

  const summary: MonthlyCostSummary = {
    month: targetMonth,
    totalEvaluated: 0,
    totalPassedWoT: 0,
    totalPassedAI: 0,
    totalDiscoveries: 0,
    totalAiCostUSD: 0,
    totalDays: 0,
    timeSavedMinutes: 0,
    timeSavedFormatted: "0min",
  };

  for (const key of Object.keys(records)) {
    if (!key.startsWith(targetMonth)) continue;
    const record = records[key];
    summary.totalEvaluated += record.articlesEvaluated;
    summary.totalPassedWoT += record.articlesPassedWoT;
    summary.totalPassedAI += record.articlesPassedAI;
    summary.totalDiscoveries += record.discoveriesFound;
    summary.totalAiCostUSD += record.aiCostUSD;
    summary.totalDays++;
  }

  const itemsSkipped = Math.max(0, summary.totalEvaluated - summary.totalPassedAI);
  summary.timeSavedMinutes = itemsSkipped * SCROLL_TIME_SAVED_PER_ITEM_MIN;

  const hours = Math.floor(summary.timeSavedMinutes / 60);
  const mins = summary.timeSavedMinutes % 60;
  summary.timeSavedFormatted = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

  return summary;
}
