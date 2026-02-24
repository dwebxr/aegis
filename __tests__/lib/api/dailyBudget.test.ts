import { withinDailyBudget, recordApiCall, _resetDailyBudget } from "@/lib/api/dailyBudget";

describe("dailyBudget", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await _resetDailyBudget();
  });

  describe("withinDailyBudget", () => {
    it("allows calls within the budget", async () => {
      expect(await withinDailyBudget()).toBe(true);
    });

    it("tracks calls and rejects when budget exhausted", async () => {
      for (let i = 0; i < 500; i++) {
        expect(await withinDailyBudget()).toBe(true);
        await recordApiCall();
      }
      expect(await withinDailyBudget()).toBe(false);
    });

    it("does not count withinDailyBudget() calls as API usage", async () => {
      for (let i = 0; i < 1000; i++) {
        await withinDailyBudget();
      }
      expect(await withinDailyBudget()).toBe(true);
    });

    it("resets counter after 24-hour boundary", async () => {
      const baseTime = 1_700_000_000_000;
      jest.spyOn(Date, "now").mockReturnValue(baseTime);
      await _resetDailyBudget();

      for (let i = 0; i < 500; i++) {
        await recordApiCall();
      }
      expect(await withinDailyBudget()).toBe(false);

      jest.spyOn(Date, "now").mockReturnValue(baseTime + 86_400_001);
      expect(await withinDailyBudget()).toBe(true);
    });

    it("does not reset before 24-hour boundary", async () => {
      const baseTime = 1_700_000_000_000;
      jest.spyOn(Date, "now").mockReturnValue(baseTime);
      await _resetDailyBudget();

      for (let i = 0; i < 500; i++) {
        await recordApiCall();
      }
      expect(await withinDailyBudget()).toBe(false);

      jest.spyOn(Date, "now").mockReturnValue(baseTime + 86_399_999);
      expect(await withinDailyBudget()).toBe(false);
    });
  });

  describe("recordApiCall", () => {
    it("increments counter independently of budget check", async () => {
      await recordApiCall();
      await recordApiCall();
      await recordApiCall();
      expect(await withinDailyBudget()).toBe(true);
    });
  });

  describe("_resetDailyBudget", () => {
    it("resets counter to zero", async () => {
      for (let i = 0; i < 500; i++) {
        await recordApiCall();
      }
      expect(await withinDailyBudget()).toBe(false);
      await _resetDailyBudget();
      expect(await withinDailyBudget()).toBe(true);
    });
  });
});
