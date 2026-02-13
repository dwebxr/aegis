import {
  recordFilterRun,
  getDailyCost,
  getMonthlyCost,
} from "@/lib/filtering/costTracker";

describe("costTracker", () => {
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

  describe("recordFilterRun", () => {
    it("creates a new daily record", () => {
      recordFilterRun({
        articlesEvaluated: 100,
        wotScoredCount: 50,
        aiScoredCount: 30,
        discoveriesFound: 2,
        aiCostUSD: 0.09,
      });

      const today = new Date().toISOString().slice(0, 10);
      const record = getDailyCost(today);
      expect(record).not.toBeNull();
      expect(record!.articlesEvaluated).toBe(100);
      expect(record!.articlesPassedWoT).toBe(50);
      expect(record!.articlesPassedAI).toBe(30);
      expect(record!.discoveriesFound).toBe(2);
      expect(record!.aiCostUSD).toBeCloseTo(0.09);
    });

    it("accumulates into existing record", () => {
      recordFilterRun({
        articlesEvaluated: 50,
        wotScoredCount: 20,
        aiScoredCount: 10,
        discoveriesFound: 1,
        aiCostUSD: 0.03,
      });
      recordFilterRun({
        articlesEvaluated: 30,
        wotScoredCount: 15,
        aiScoredCount: 5,
        discoveriesFound: 0,
        aiCostUSD: 0.015,
      });

      const today = new Date().toISOString().slice(0, 10);
      const record = getDailyCost(today);
      expect(record!.articlesEvaluated).toBe(80);
      expect(record!.articlesPassedWoT).toBe(35);
      expect(record!.articlesPassedAI).toBe(15);
      expect(record!.discoveriesFound).toBe(1);
      expect(record!.aiCostUSD).toBeCloseTo(0.045);
    });
  });

  describe("getDailyCost", () => {
    it("returns null for missing date", () => {
      expect(getDailyCost("2020-01-01")).toBeNull();
    });

    it("returns null when localStorage is empty", () => {
      expect(getDailyCost()).toBeNull();
    });
  });

  describe("getMonthlyCost", () => {
    it("aggregates across days", () => {
      const month = new Date().toISOString().slice(0, 7);
      const day1 = `${month}-01`;
      const day2 = `${month}-02`;

      store["aegis-cost-tracker"] = JSON.stringify({
        [day1]: { date: day1, articlesEvaluated: 100, articlesPassedWoT: 50, articlesPassedAI: 30, discoveriesFound: 2, aiCostUSD: 0.09 },
        [day2]: { date: day2, articlesEvaluated: 200, articlesPassedWoT: 100, articlesPassedAI: 60, discoveriesFound: 3, aiCostUSD: 0.18 },
      });

      const summary = getMonthlyCost(month);
      expect(summary.totalEvaluated).toBe(300);
      expect(summary.totalPassedWoT).toBe(150);
      expect(summary.totalPassedAI).toBe(90);
      expect(summary.totalDiscoveries).toBe(5);
      expect(summary.totalAiCostUSD).toBeCloseTo(0.27);
      expect(summary.totalDays).toBe(2);
    });

    it("calculates time saved", () => {
      const month = new Date().toISOString().slice(0, 7);
      const day = `${month}-01`;

      store["aegis-cost-tracker"] = JSON.stringify({
        [day]: { date: day, articlesEvaluated: 100, articlesPassedWoT: 50, articlesPassedAI: 20, discoveriesFound: 0, aiCostUSD: 0 },
      });

      const summary = getMonthlyCost(month);
      // filteredOut = 100 - 20 = 80, timeSaved = 80 * 3 = 240 min
      expect(summary.timeSavedMinutes).toBe(240);
    });

    it("formats time correctly (hours + minutes)", () => {
      const month = new Date().toISOString().slice(0, 7);
      const day = `${month}-01`;

      store["aegis-cost-tracker"] = JSON.stringify({
        [day]: { date: day, articlesEvaluated: 100, articlesPassedWoT: 50, articlesPassedAI: 20, discoveriesFound: 0, aiCostUSD: 0 },
      });

      const summary = getMonthlyCost(month);
      // 240 min = 4h 0min
      expect(summary.timeSavedFormatted).toBe("4h 0min");
    });

    it("formats minutes only when less than 1 hour", () => {
      const month = new Date().toISOString().slice(0, 7);
      const day = `${month}-01`;

      store["aegis-cost-tracker"] = JSON.stringify({
        [day]: { date: day, articlesEvaluated: 10, articlesPassedWoT: 5, articlesPassedAI: 5, discoveriesFound: 0, aiCostUSD: 0 },
      });

      const summary = getMonthlyCost(month);
      // filteredOut = 10 - 5 = 5, timeSaved = 15 min
      expect(summary.timeSavedFormatted).toBe("15min");
    });

    it("returns zero summary for empty month", () => {
      const summary = getMonthlyCost("2020-01");
      expect(summary.totalEvaluated).toBe(0);
      expect(summary.totalDays).toBe(0);
      expect(summary.timeSavedFormatted).toBe("0min");
    });
  });

  describe("storage edge cases", () => {
    it("handles missing localStorage gracefully", () => {
      delete (globalThis as Record<string, unknown>).localStorage;
      // Should not throw
      recordFilterRun({ articlesEvaluated: 10, wotScoredCount: 5, aiScoredCount: 3, discoveriesFound: 0, aiCostUSD: 0 });
      expect(getDailyCost()).toBeNull();
      const summary = getMonthlyCost();
      expect(summary.totalDays).toBe(0);
    });

    it("handles corrupted JSON gracefully", () => {
      store["aegis-cost-tracker"] = "not valid json{{{";
      expect(getDailyCost()).toBeNull();
    });

    it("prunes records beyond 90 days", () => {
      const records: Record<string, { date: string; articlesEvaluated: number; articlesPassedWoT: number; articlesPassedAI: number; discoveriesFound: number; aiCostUSD: number }> = {};
      for (let i = 0; i < 100; i++) {
        const date = `2025-01-${String(i + 1).padStart(2, "0")}`;
        records[date] = { date, articlesEvaluated: 1, articlesPassedWoT: 0, articlesPassedAI: 0, discoveriesFound: 0, aiCostUSD: 0 };
      }
      store["aegis-cost-tracker"] = JSON.stringify(records);

      // Trigger a save by recording a run
      recordFilterRun({ articlesEvaluated: 1, wotScoredCount: 0, aiScoredCount: 0, discoveriesFound: 0, aiCostUSD: 0 });

      const saved = JSON.parse(store["aegis-cost-tracker"]);
      expect(Object.keys(saved).length).toBeLessThanOrEqual(90);
    });
  });
});
