/**
 * Thorough tests for costTracker — accumulation, pruning, monthly summaries,
 * time-saved calculation, and persistence edge cases.
 */
import {
  recordFilterRun,
  getDailyCost,
  getMonthlyCost,
  SCROLL_TIME_SAVED_PER_ITEM_MIN,
  type DailyCostRecord,
  type MonthlyCostSummary,
} from "@/lib/filtering/costTracker";

const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    writable: true,
  });
});
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
});

describe("recordFilterRun — accumulation", () => {
  it("creates new record for today", () => {
    recordFilterRun({ articlesEvaluated: 10, wotScoredCount: 3, aiScoredCount: 5, discoveriesFound: 2, aiCostUSD: 0.015 });
    const today = new Date().toISOString().slice(0, 10);
    const record = getDailyCost(today);
    expect(record).not.toBeNull();
    expect(record!.articlesEvaluated).toBe(10);
    expect(record!.articlesPassedWoT).toBe(3);
    expect(record!.articlesPassedAI).toBe(5);
    expect(record!.discoveriesFound).toBe(2);
    expect(record!.aiCostUSD).toBe(0.015);
  });

  it("accumulates multiple runs on same day", () => {
    recordFilterRun({ articlesEvaluated: 10, wotScoredCount: 3, aiScoredCount: 5, discoveriesFound: 2, aiCostUSD: 0.01 });
    recordFilterRun({ articlesEvaluated: 20, wotScoredCount: 7, aiScoredCount: 10, discoveriesFound: 3, aiCostUSD: 0.02 });
    const today = new Date().toISOString().slice(0, 10);
    const record = getDailyCost(today)!;
    expect(record.articlesEvaluated).toBe(30);
    expect(record.articlesPassedWoT).toBe(10);
    expect(record.articlesPassedAI).toBe(15);
    expect(record.discoveriesFound).toBe(5);
    expect(record.aiCostUSD).toBeCloseTo(0.03, 4);
  });

  it("zero-value run doesn't corrupt existing data", () => {
    recordFilterRun({ articlesEvaluated: 10, wotScoredCount: 3, aiScoredCount: 5, discoveriesFound: 2, aiCostUSD: 0.01 });
    recordFilterRun({ articlesEvaluated: 0, wotScoredCount: 0, aiScoredCount: 0, discoveriesFound: 0, aiCostUSD: 0 });
    const today = new Date().toISOString().slice(0, 10);
    const record = getDailyCost(today)!;
    expect(record.articlesEvaluated).toBe(10);
  });
});

describe("getDailyCost", () => {
  it("returns null for nonexistent date", () => {
    expect(getDailyCost("1999-01-01")).toBeNull();
  });

  it("defaults to today when no date provided", () => {
    recordFilterRun({ articlesEvaluated: 5, wotScoredCount: 0, aiScoredCount: 0, discoveriesFound: 0, aiCostUSD: 0 });
    expect(getDailyCost()).not.toBeNull();
    expect(getDailyCost()!.articlesEvaluated).toBe(5);
  });
});

describe("getMonthlyCost — aggregation", () => {
  it("aggregates all days in a month", () => {
    const month = "2025-01";
    // Simulate records for specific dates
    const records: Record<string, DailyCostRecord> = {
      "2025-01-01": { date: "2025-01-01", articlesEvaluated: 10, articlesPassedWoT: 3, articlesPassedAI: 5, discoveriesFound: 2, aiCostUSD: 0.015 },
      "2025-01-15": { date: "2025-01-15", articlesEvaluated: 20, articlesPassedWoT: 7, articlesPassedAI: 10, discoveriesFound: 4, aiCostUSD: 0.03 },
      "2025-02-01": { date: "2025-02-01", articlesEvaluated: 100, articlesPassedWoT: 50, articlesPassedAI: 50, discoveriesFound: 20, aiCostUSD: 0.15 },
    };
    store["aegis-cost-tracker"] = JSON.stringify(records);

    const summary = getMonthlyCost(month);
    expect(summary.month).toBe("2025-01");
    expect(summary.totalEvaluated).toBe(30);
    expect(summary.totalPassedWoT).toBe(10);
    expect(summary.totalPassedAI).toBe(15);
    expect(summary.totalDiscoveries).toBe(6);
    expect(summary.totalAiCostUSD).toBeCloseTo(0.045, 4);
    expect(summary.totalDays).toBe(2);
  });

  it("defaults to current month", () => {
    recordFilterRun({ articlesEvaluated: 5, wotScoredCount: 1, aiScoredCount: 2, discoveriesFound: 1, aiCostUSD: 0.005 });
    const summary = getMonthlyCost();
    expect(summary.totalEvaluated).toBe(5);
  });

  it("returns zero summary for nonexistent month", () => {
    const summary = getMonthlyCost("1999-01");
    expect(summary.totalEvaluated).toBe(0);
    expect(summary.totalDays).toBe(0);
    expect(summary.timeSavedMinutes).toBe(0);
  });
});

describe("getMonthlyCost — time saved calculation", () => {
  it("timeSaved = (evaluated - passedAI) * 3 min", () => {
    const records: Record<string, DailyCostRecord> = {
      "2025-03-01": { date: "2025-03-01", articlesEvaluated: 100, articlesPassedWoT: 0, articlesPassedAI: 20, discoveriesFound: 0, aiCostUSD: 0 },
    };
    store["aegis-cost-tracker"] = JSON.stringify(records);

    const summary = getMonthlyCost("2025-03");
    // itemsSkipped = max(0, 100 - 20) = 80
    // timeSaved = 80 * 3 = 240 min = 4h 0min
    expect(summary.timeSavedMinutes).toBe(240);
    expect(summary.timeSavedFormatted).toBe("4h 0min");
  });

  it("formats hours and minutes correctly", () => {
    const records: Record<string, DailyCostRecord> = {
      "2025-03-01": { date: "2025-03-01", articlesEvaluated: 50, articlesPassedWoT: 0, articlesPassedAI: 10, discoveriesFound: 0, aiCostUSD: 0 },
    };
    store["aegis-cost-tracker"] = JSON.stringify(records);

    const summary = getMonthlyCost("2025-03");
    // 40 * 3 = 120 min = 2h 0min
    expect(summary.timeSavedFormatted).toBe("2h 0min");
  });

  it("minutes-only format when < 1 hour", () => {
    const records: Record<string, DailyCostRecord> = {
      "2025-04-01": { date: "2025-04-01", articlesEvaluated: 15, articlesPassedWoT: 0, articlesPassedAI: 5, discoveriesFound: 0, aiCostUSD: 0 },
    };
    store["aegis-cost-tracker"] = JSON.stringify(records);

    const summary = getMonthlyCost("2025-04");
    // 10 * 3 = 30min
    expect(summary.timeSavedFormatted).toBe("30min");
  });

  it("zero time saved when all items pass AI", () => {
    const records: Record<string, DailyCostRecord> = {
      "2025-05-01": { date: "2025-05-01", articlesEvaluated: 10, articlesPassedWoT: 0, articlesPassedAI: 10, discoveriesFound: 0, aiCostUSD: 0 },
    };
    store["aegis-cost-tracker"] = JSON.stringify(records);

    const summary = getMonthlyCost("2025-05");
    expect(summary.timeSavedMinutes).toBe(0);
    expect(summary.timeSavedFormatted).toBe("0min");
  });

  it("handles passedAI > evaluated (edge case: no negative)", () => {
    const records: Record<string, DailyCostRecord> = {
      "2025-06-01": { date: "2025-06-01", articlesEvaluated: 5, articlesPassedWoT: 0, articlesPassedAI: 10, discoveriesFound: 0, aiCostUSD: 0 },
    };
    store["aegis-cost-tracker"] = JSON.stringify(records);

    const summary = getMonthlyCost("2025-06");
    expect(summary.timeSavedMinutes).toBe(0); // max(0, 5-10) = 0
  });
});

describe("costTracker — persistence edge cases", () => {
  it("handles corrupted JSON in localStorage", () => {
    store["aegis-cost-tracker"] = "{{not json";
    // recordFilterRun should not crash
    expect(() => recordFilterRun({
      articlesEvaluated: 1, wotScoredCount: 0, aiScoredCount: 0, discoveriesFound: 0, aiCostUSD: 0,
    })).not.toThrow();
  });

  it("prunes records beyond 90 days", () => {
    const records: Record<string, DailyCostRecord> = {};
    for (let i = 0; i < 95; i++) {
      const date = new Date(2025, 0, i + 1).toISOString().slice(0, 10);
      records[date] = { date, articlesEvaluated: 1, articlesPassedWoT: 0, articlesPassedAI: 0, discoveriesFound: 0, aiCostUSD: 0 };
    }
    store["aegis-cost-tracker"] = JSON.stringify(records);

    // Trigger a save (which prunes)
    recordFilterRun({ articlesEvaluated: 1, wotScoredCount: 0, aiScoredCount: 0, discoveriesFound: 0, aiCostUSD: 0 });

    // Verify storage was pruned
    const saved = JSON.parse(store["aegis-cost-tracker"]);
    expect(Object.keys(saved).length).toBeLessThanOrEqual(90);
  });
});

describe("constants", () => {
  it("SCROLL_TIME_SAVED_PER_ITEM_MIN is 3", () => {
    expect(SCROLL_TIME_SAVED_PER_ITEM_MIN).toBe(3);
  });
});
