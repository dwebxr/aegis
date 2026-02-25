/**
 * Tests for the Vercel KV (Redis) code path in dailyBudget.
 * The base test file only exercises the in-memory fallback because
 * KV_REST_API_URL is unset. This file mocks @vercel/kv to verify
 * the Redis-backed path: atomic INCR, TTL on first key, 90% warning,
 * and graceful fallback when the import fails.
 */

describe("dailyBudget — KV code path", () => {
  const mockStore = {
    get: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(() => {
    jest.resetModules();
    mockStore.get.mockReset();
    mockStore.incr.mockReset();
    mockStore.expire.mockReset();
    mockStore.del.mockReset();
  });

  afterEach(() => {
    delete process.env.KV_REST_API_URL;
  });

  function loadWithKV() {
    process.env.KV_REST_API_URL = "https://fake-kv.upstash.io";
    jest.doMock("@vercel/kv", () => ({ kv: mockStore }));
    return require("@/lib/api/dailyBudget") as typeof import("@/lib/api/dailyBudget");
  }

  function loadWithKVFailure() {
    process.env.KV_REST_API_URL = "https://fake-kv.upstash.io";
    jest.doMock("@vercel/kv", () => {
      throw new Error("KV unavailable");
    });
    return require("@/lib/api/dailyBudget") as typeof import("@/lib/api/dailyBudget");
  }

  describe("withinDailyBudget (KV path)", () => {
    it("returns true when Redis count is below budget", async () => {
      const mod = loadWithKV();
      mockStore.get.mockResolvedValue(10);
      expect(await mod.withinDailyBudget()).toBe(true);
      expect(mockStore.get).toHaveBeenCalledWith(expect.stringMatching(/^aegis:api-calls:\d{4}-\d{2}-\d{2}$/));
    });

    it("returns false when Redis count meets budget", async () => {
      const mod = loadWithKV();
      mockStore.get.mockResolvedValue(500);
      expect(await mod.withinDailyBudget()).toBe(false);
    });

    it("treats null Redis response as 0 (new day)", async () => {
      const mod = loadWithKV();
      mockStore.get.mockResolvedValue(null);
      expect(await mod.withinDailyBudget()).toBe(true);
    });
  });

  describe("recordApiCall (KV path)", () => {
    it("increments Redis counter atomically", async () => {
      const mod = loadWithKV();
      mockStore.incr.mockResolvedValue(5);
      await mod.recordApiCall();
      expect(mockStore.incr).toHaveBeenCalledWith(expect.stringMatching(/^aegis:api-calls:/));
    });

    it("sets TTL on first increment (count === 1)", async () => {
      const mod = loadWithKV();
      mockStore.incr.mockResolvedValue(1);
      await mod.recordApiCall();
      expect(mockStore.expire).toHaveBeenCalledWith(expect.stringMatching(/^aegis:api-calls:/), 86_400);
    });

    it("does not set TTL on subsequent increments", async () => {
      const mod = loadWithKV();
      mockStore.incr.mockResolvedValue(2);
      await mod.recordApiCall();
      expect(mockStore.expire).not.toHaveBeenCalled();
    });

    it("logs warning at 90% budget consumption", async () => {
      const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const mod = loadWithKV();
        // Budget = 500, 90% threshold = 500 - 50 = 450
        mockStore.incr.mockResolvedValue(450);
        await mod.recordApiCall();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("90% consumed"));
      } finally {
        spy.mockRestore();
      }
    });

    it("does not warn below 90% threshold", async () => {
      const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const mod = loadWithKV();
        mockStore.incr.mockResolvedValue(449);
        await mod.recordApiCall();
        expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("90% consumed"));
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("_resetDailyBudget (KV path)", () => {
    it("deletes the daily key from Redis", async () => {
      const mod = loadWithKV();
      mockStore.del.mockResolvedValue(1);
      await mod._resetDailyBudget();
      expect(mockStore.del).toHaveBeenCalledWith(expect.stringMatching(/^aegis:api-calls:/));
    });
  });

  describe("KV import failure fallback", () => {
    it("falls back to in-memory when @vercel/kv import throws", async () => {
      const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const mod = loadWithKVFailure();
        expect(await mod.withinDailyBudget()).toBe(true);
        await mod.recordApiCall();
        expect(await mod.withinDailyBudget()).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it("logs warning when KV import fails", async () => {
      const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const mod = loadWithKVFailure();
        await mod.withinDailyBudget();
        expect(spy).toHaveBeenCalledWith(
          expect.stringContaining("[dailyBudget] KV import failed"),
          expect.any(Error),
        );
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("daily key format", () => {
    it("uses UTC date in key (ISO 8601 YYYY-MM-DD)", async () => {
      const mod = loadWithKV();
      mockStore.get.mockResolvedValue(0);
      await mod.withinDailyBudget();
      const calledKey = mockStore.get.mock.calls[0][0] as string;
      expect(calledKey).toMatch(/^aegis:api-calls:\d{4}-\d{2}-\d{2}$/);
      const datePart = calledKey.split(":")[2];
      expect(new Date(datePart).toISOString().slice(0, 10)).toBe(datePart);
    });
  });
});
