import { withinDailyBudget, recordApiCall, _resetDailyBudget } from "@/lib/api/dailyBudget";

describe("dailyBudget", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    _resetDailyBudget();
  });

  describe("withinDailyBudget", () => {
    it("allows calls within the budget", () => {
      expect(withinDailyBudget()).toBe(true);
    });

    it("tracks calls and rejects when budget exhausted", () => {
      for (let i = 0; i < 500; i++) {
        expect(withinDailyBudget()).toBe(true);
        recordApiCall();
      }
      expect(withinDailyBudget()).toBe(false);
    });

    it("does not count withinDailyBudget() calls as API usage", () => {
      for (let i = 0; i < 1000; i++) {
        withinDailyBudget();
      }
      expect(withinDailyBudget()).toBe(true);
    });

    it("resets counter after 24-hour boundary", () => {
      const baseTime = 1_700_000_000_000;
      jest.spyOn(Date, "now").mockReturnValue(baseTime);
      _resetDailyBudget();

      for (let i = 0; i < 500; i++) {
        recordApiCall();
      }
      expect(withinDailyBudget()).toBe(false);

      jest.spyOn(Date, "now").mockReturnValue(baseTime + 86_400_001);
      expect(withinDailyBudget()).toBe(true);
    });

    it("does not reset before 24-hour boundary", () => {
      const baseTime = 1_700_000_000_000;
      jest.spyOn(Date, "now").mockReturnValue(baseTime);
      _resetDailyBudget();

      for (let i = 0; i < 500; i++) {
        recordApiCall();
      }
      expect(withinDailyBudget()).toBe(false);

      jest.spyOn(Date, "now").mockReturnValue(baseTime + 86_399_999);
      expect(withinDailyBudget()).toBe(false);
    });
  });

  describe("recordApiCall", () => {
    it("increments counter independently of budget check", () => {
      recordApiCall();
      recordApiCall();
      recordApiCall();
      expect(withinDailyBudget()).toBe(true);
    });
  });

  describe("_resetDailyBudget", () => {
    it("resets counter to zero", () => {
      for (let i = 0; i < 500; i++) {
        recordApiCall();
      }
      expect(withinDailyBudget()).toBe(false);
      _resetDailyBudget();
      expect(withinDailyBudget()).toBe(true);
    });
  });
});
