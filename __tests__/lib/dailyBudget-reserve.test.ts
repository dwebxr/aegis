const mockCaptureException = jest.fn();

jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

function setNodeEnv(value: string): void {
  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

describe("score daily budget reservation", () => {
  const originalEnv = { ...process.env };
  const mockStore = {
    set: jest.fn(),
    incr: jest.fn(),
    decr: jest.fn(),
    ttl: jest.fn(),
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.KV_REST_API_URL = "https://fake-kv.upstash.io";
    process.env.SCORE_DAILY_BUDGET = "2";
    setNodeEnv("test");
    mockStore.set.mockResolvedValue("OK");
    mockStore.incr.mockResolvedValue(1);
    mockStore.decr.mockResolvedValue(2);
    mockStore.ttl.mockResolvedValue(3600);
    jest.doMock("@vercel/kv", () => ({ kv: mockStore }));
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  function load() {
    return require("@/lib/api/dailyBudget") as typeof import("@/lib/api/dailyBudget");
  }

  it("initializes with SET NX EX before incrementing", async () => {
    const { tryReserveScoreBudget } = load();
    await expect(tryReserveScoreBudget()).resolves.toBe(true);

    expect(mockStore.set).toHaveBeenCalledWith(
      expect.stringMatching(/^aegis:score-calls:\d{4}-\d{2}-\d{2}$/),
      0,
      { nx: true, ex: 86_400 },
    );
    expect(mockStore.set.mock.invocationCallOrder[0])
      .toBeLessThan(mockStore.incr.mock.invocationCallOrder[0]);
  });

  it("decrements and denies a reservation above the limit", async () => {
    mockStore.incr.mockResolvedValueOnce(3);
    const { tryReserveScoreBudget } = load();

    await expect(tryReserveScoreBudget()).resolves.toBe(false);
    expect(mockStore.decr).toHaveBeenCalledWith(
      expect.stringMatching(/^aegis:score-calls:/),
    );
  });

  it("reports DECR failure and remains denied", async () => {
    mockStore.incr.mockResolvedValueOnce(3);
    mockStore.decr.mockRejectedValueOnce(new Error("decr failed"));
    const { tryReserveScoreBudget } = load();

    await expect(tryReserveScoreBudget()).resolves.toBe(false);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { module: "dailyBudget", failure: "score-budget-decr" },
      }),
    );
  });

  it("propagates KV command failures", async () => {
    mockStore.set.mockRejectedValueOnce(new Error("KV unavailable"));
    const { tryReserveScoreBudget } = load();
    await expect(tryReserveScoreBudget()).rejects.toThrow("KV unavailable");
  });

  it("uses memory only in development or test and fails closed in production", async () => {
    delete process.env.KV_REST_API_URL;
    const testModule = load();
    await expect(testModule.tryReserveScoreBudget()).resolves.toBe(true);

    jest.resetModules();
    setNodeEnv("production");
    const productionModule = load();
    await expect(productionModule.tryReserveScoreBudget()).rejects.toThrow("requires KV");
  });

  it("uses the smaller positive value for Retry-After", async () => {
    mockStore.ttl.mockResolvedValueOnce(120);
    const { getScoreBudgetRetryAfter } = load();
    await expect(getScoreBudgetRetryAfter()).resolves.toBe(120);

    mockStore.ttl.mockResolvedValueOnce(-1);
    await expect(getScoreBudgetRetryAfter()).resolves.toBeGreaterThan(0);
  });
});
