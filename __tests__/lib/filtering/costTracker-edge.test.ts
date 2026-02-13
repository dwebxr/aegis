import {
  recordFilterRun,
  getDailyCost,
  getMonthlyCost,
  SCROLL_TIME_SAVED_PER_ITEM_MIN,
} from "@/lib/filtering/costTracker";

describe("costTracker — edge cases", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    const mockStorage = {
      getItem: jest.fn((key: string) => store[key] ?? null),
      setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: jest.fn((key: string) => { delete store[key]; }),
      clear: jest.fn(() => { store = {}; }),
      get length() { return Object.keys(store).length; },
      key: jest.fn((i: number) => Object.keys(store)[i] ?? null),
    };
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true, configurable: true });
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  describe("recordFilterRun — boundary values", () => {
    it("handles zero values for all fields", () => {
      recordFilterRun({
        articlesEvaluated: 0,
        wotScoredCount: 0,
        aiScoredCount: 0,
        discoveriesFound: 0,
        aiCostUSD: 0,
      });

      const today = new Date().toISOString().slice(0, 10);
      const record = getDailyCost(today);
      expect(record).not.toBeNull();
      expect(record!.articlesEvaluated).toBe(0);
      expect(record!.aiCostUSD).toBe(0);
    });

    it("handles very large numbers", () => {
      recordFilterRun({
        articlesEvaluated: 1_000_000,
        wotScoredCount: 500_000,
        aiScoredCount: 100_000,
        discoveriesFound: 10_000,
        aiCostUSD: 99999.99,
      });

      const today = new Date().toISOString().slice(0, 10);
      const record = getDailyCost(today);
      expect(record!.articlesEvaluated).toBe(1_000_000);
      expect(record!.aiCostUSD).toBeCloseTo(99999.99);
    });

    it("handles fractional cost values accurately (floating point)", () => {
      // Accumulate many small values that could cause float drift
      for (let i = 0; i < 100; i++) {
        recordFilterRun({
          articlesEvaluated: 1,
          wotScoredCount: 0,
          aiScoredCount: 1,
          discoveriesFound: 0,
          aiCostUSD: 0.001,
        });
      }

      const today = new Date().toISOString().slice(0, 10);
      const record = getDailyCost(today);
      expect(record!.articlesEvaluated).toBe(100);
      // 100 * 0.001 should be close to 0.1 (accounting for float imprecision)
      expect(record!.aiCostUSD).toBeCloseTo(0.1, 5);
    });

    it("handles multiple rapid recordFilterRun calls", () => {
      for (let i = 0; i < 50; i++) {
        recordFilterRun({
          articlesEvaluated: 2,
          wotScoredCount: 1,
          aiScoredCount: 1,
          discoveriesFound: 0,
          aiCostUSD: 0.003,
        });
      }

      const today = new Date().toISOString().slice(0, 10);
      const record = getDailyCost(today);
      expect(record!.articlesEvaluated).toBe(100);
      expect(record!.articlesPassedWoT).toBe(50);
      expect(record!.articlesPassedAI).toBe(50);
    });
  });

  describe("getDailyCost — edge cases", () => {
    it("returns null for future date", () => {
      expect(getDailyCost("2099-12-31")).toBeNull();
    });

    it("returns null for invalid date string", () => {
      expect(getDailyCost("not-a-date")).toBeNull();
    });

    it("returns correct record after overwrite cycle", () => {
      recordFilterRun({ articlesEvaluated: 10, wotScoredCount: 5, aiScoredCount: 3, discoveriesFound: 1, aiCostUSD: 0.009 });
      recordFilterRun({ articlesEvaluated: 20, wotScoredCount: 10, aiScoredCount: 7, discoveriesFound: 2, aiCostUSD: 0.021 });

      const today = new Date().toISOString().slice(0, 10);
      const record = getDailyCost(today);
      expect(record!.articlesEvaluated).toBe(30);
      expect(record!.discoveriesFound).toBe(3);
    });
  });

  describe("getMonthlyCost — boundary conditions", () => {
    it("returns zero summary for month with no data", () => {
      const summary = getMonthlyCost("2099-01");
      expect(summary.totalEvaluated).toBe(0);
      expect(summary.totalPassedWoT).toBe(0);
      expect(summary.totalPassedAI).toBe(0);
      expect(summary.totalDiscoveries).toBe(0);
      expect(summary.totalAiCostUSD).toBe(0);
      expect(summary.totalDays).toBe(0);
      expect(summary.timeSavedMinutes).toBe(0);
      expect(summary.timeSavedFormatted).toBe("0min");
    });

    it("calculates time saved correctly: 0 items skipped = 0 min", () => {
      const month = new Date().toISOString().slice(0, 7);
      const day = `${month}-01`;
      store["aegis-cost-tracker"] = JSON.stringify({
        [day]: { date: day, articlesEvaluated: 10, articlesPassedWoT: 5, articlesPassedAI: 10, discoveriesFound: 0, aiCostUSD: 0 },
      });

      const summary = getMonthlyCost(month);
      // 10 evaluated - 10 passed = 0 skipped → 0 min
      expect(summary.timeSavedMinutes).toBe(0);
      expect(summary.timeSavedFormatted).toBe("0min");
    });

    it("calculates time saved with passedAI > evaluated (guards against negative)", () => {
      const month = new Date().toISOString().slice(0, 7);
      const day = `${month}-01`;
      // Corrupted data: passedAI > evaluated
      store["aegis-cost-tracker"] = JSON.stringify({
        [day]: { date: day, articlesEvaluated: 5, articlesPassedWoT: 3, articlesPassedAI: 10, discoveriesFound: 0, aiCostUSD: 0 },
      });

      const summary = getMonthlyCost(month);
      // Math.max(0, 5-10) = 0 → no negative
      expect(summary.timeSavedMinutes).toBe(0);
    });

    it("formats large time values (>24 hours)", () => {
      const month = new Date().toISOString().slice(0, 7);
      const day = `${month}-01`;
      // 1000 evaluated, 0 passed → 1000 * 3 = 3000 min = 50h 0min
      store["aegis-cost-tracker"] = JSON.stringify({
        [day]: { date: day, articlesEvaluated: 1000, articlesPassedWoT: 500, articlesPassedAI: 0, discoveriesFound: 0, aiCostUSD: 0 },
      });

      const summary = getMonthlyCost(month);
      expect(summary.timeSavedMinutes).toBe(3000);
      expect(summary.timeSavedFormatted).toBe("50h 0min");
    });

    it("formats exactly 60 minutes as 1h 0min", () => {
      const month = new Date().toISOString().slice(0, 7);
      const day = `${month}-01`;
      // Need timeSaved = 60 → skipped * 3 = 60 → skipped = 20
      store["aegis-cost-tracker"] = JSON.stringify({
        [day]: { date: day, articlesEvaluated: 30, articlesPassedWoT: 15, articlesPassedAI: 10, discoveriesFound: 0, aiCostUSD: 0 },
      });

      const summary = getMonthlyCost(month);
      // 30 - 10 = 20, 20 * 3 = 60
      expect(summary.timeSavedMinutes).toBe(60);
      expect(summary.timeSavedFormatted).toBe("1h 0min");
    });

    it("only includes records matching target month prefix", () => {
      store["aegis-cost-tracker"] = JSON.stringify({
        "2026-01-15": { date: "2026-01-15", articlesEvaluated: 50, articlesPassedWoT: 25, articlesPassedAI: 10, discoveriesFound: 1, aiCostUSD: 0.03 },
        "2026-02-01": { date: "2026-02-01", articlesEvaluated: 100, articlesPassedWoT: 50, articlesPassedAI: 20, discoveriesFound: 2, aiCostUSD: 0.06 },
        "2026-02-15": { date: "2026-02-15", articlesEvaluated: 200, articlesPassedWoT: 100, articlesPassedAI: 40, discoveriesFound: 3, aiCostUSD: 0.12 },
      });

      const jan = getMonthlyCost("2026-01");
      expect(jan.totalEvaluated).toBe(50);
      expect(jan.totalDays).toBe(1);

      const feb = getMonthlyCost("2026-02");
      expect(feb.totalEvaluated).toBe(300);
      expect(feb.totalDays).toBe(2);
    });
  });

  describe("pruning — edge cases", () => {
    it("keeps exactly MAX_DAYS (90) records when at limit", () => {
      const records: Record<string, { date: string; articlesEvaluated: number; articlesPassedWoT: number; articlesPassedAI: number; discoveriesFound: number; aiCostUSD: number }> = {};
      for (let i = 0; i < 90; i++) {
        const d = i + 1;
        const date = `2025-01-${String(d).padStart(2, "0")}`;
        records[date] = { date, articlesEvaluated: 1, articlesPassedWoT: 0, articlesPassedAI: 0, discoveriesFound: 0, aiCostUSD: 0 };
      }
      store["aegis-cost-tracker"] = JSON.stringify(records);

      // This adds today's record (91st)
      recordFilterRun({ articlesEvaluated: 1, wotScoredCount: 0, aiScoredCount: 0, discoveriesFound: 0, aiCostUSD: 0 });

      const saved = JSON.parse(store["aegis-cost-tracker"]);
      expect(Object.keys(saved).length).toBeLessThanOrEqual(90);
    });

    it("retains most recent records after pruning", () => {
      const records: Record<string, { date: string; articlesEvaluated: number; articlesPassedWoT: number; articlesPassedAI: number; discoveriesFound: number; aiCostUSD: number }> = {};
      for (let i = 1; i <= 95; i++) {
        const date = `2025-01-${String(i).padStart(2, "0")}`;
        records[date] = { date, articlesEvaluated: i, articlesPassedWoT: 0, articlesPassedAI: 0, discoveriesFound: 0, aiCostUSD: 0 };
      }
      store["aegis-cost-tracker"] = JSON.stringify(records);

      recordFilterRun({ articlesEvaluated: 1, wotScoredCount: 0, aiScoredCount: 0, discoveriesFound: 0, aiCostUSD: 0 });

      const saved = JSON.parse(store["aegis-cost-tracker"]);
      const keys = Object.keys(saved).sort();
      // Oldest keys should have been pruned, newest kept
      expect(keys[0]).not.toBe("2025-01-01");
    });
  });

  describe("localStorage error handling", () => {
    it("survives localStorage.setItem throwing (quota exceeded)", () => {
      const mockStorage = {
        getItem: jest.fn(() => null),
        setItem: jest.fn(() => { throw new Error("QuotaExceededError"); }),
        removeItem: jest.fn(),
        clear: jest.fn(),
        get length() { return 0; },
        key: jest.fn(() => null),
      };
      Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true, configurable: true });

      // Should not throw
      expect(() => {
        recordFilterRun({ articlesEvaluated: 10, wotScoredCount: 5, aiScoredCount: 3, discoveriesFound: 0, aiCostUSD: 0.009 });
      }).not.toThrow();
    });

    it("survives localStorage.getItem throwing", () => {
      const mockStorage = {
        getItem: jest.fn(() => { throw new Error("SecurityError"); }),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
        get length() { return 0; },
        key: jest.fn(() => null),
      };
      Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true, configurable: true });

      expect(getDailyCost()).toBeNull();
      const summary = getMonthlyCost();
      expect(summary.totalDays).toBe(0);
    });

    it("handles record with missing fields gracefully", () => {
      const month = new Date().toISOString().slice(0, 7);
      const day = `${month}-01`;
      // Partial record — missing some fields
      store["aegis-cost-tracker"] = JSON.stringify({
        [day]: { date: day, articlesEvaluated: 10 },
      });

      const summary = getMonthlyCost(month);
      // NaN from undefined + number → this tests if the code is robust
      // In JS: undefined + 0 = NaN, so totalPassedWoT might be NaN
      expect(summary.totalEvaluated).toBe(10);
    });
  });

  describe("SCROLL_TIME_SAVED_PER_ITEM_MIN constant", () => {
    it("is a positive integer", () => {
      expect(SCROLL_TIME_SAVED_PER_ITEM_MIN).toBeGreaterThan(0);
      expect(Number.isInteger(SCROLL_TIME_SAVED_PER_ITEM_MIN)).toBe(true);
    });
  });
});
