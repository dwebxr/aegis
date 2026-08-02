/**
 * /api/health is polled by machines, so it is allowed a short shared-cache
 * window — but only under rules that keep it from reporting health it has not
 * verified. These tests pin those rules, plus the per-outcome probe caching that
 * makes the underlying IC query cheap without freezing a bad state in place.
 */
import { GET } from "@/app/api/health/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import { checkCanisterCycles, _resetCyclesCache, _resetReachableCache } from "@/lib/ic/health";

jest.mock("@/lib/ic/health", () => {
  const actual = jest.requireActual("@/lib/ic/health");
  return { ...actual, checkCanisterCycles: jest.fn() };
});

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/health", { method: "GET", headers });
}

const fetchMock = jest.fn();
global.fetch = fetchMock;
const cyclesMock = checkCanisterCycles as jest.MockedFunction<typeof checkCanisterCycles>;

describe("/api/health cache headers", () => {
  const origEnv = process.env;

  beforeEach(() => {
    _resetRateLimits();
    _resetCyclesCache();
    _resetReachableCache();
    fetchMock.mockResolvedValue({ status: 400, ok: false });
    cyclesMock.mockResolvedValue({ status: "ok", balance: "5000000000000" });
    process.env = { ...origEnv, ANTHROPIC_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = origEnv;
    fetchMock.mockReset();
  });

  it("gives the shared cache a bounded window on a healthy response", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=30");
  });

  it("never lets a cached response outlive its window", async () => {
    const res = await GET(makeRequest());
    // stale-while-revalidate would keep serving the last "ok" after the state
    // changed — exactly what a status-only monitor must not see.
    expect(res.headers.get("Cache-Control")).not.toContain("stale-while-revalidate");
  });

  it("does not cache a degraded response", async () => {
    cyclesMock.mockResolvedValue({ status: "low", balance: "1000000000000" });

    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not cache a response whose body was gated on Authorization", async () => {
    process.env = { ...origEnv, ANTHROPIC_API_KEY: "test-key", HEALTH_DETAIL_TOKEN: "secret" };

    const res = await GET(makeRequest({ authorization: "Bearer secret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("checks");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("declares Authorization as a cache dimension", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("Vary")).toBe("Authorization");
  });

  it("keeps the detail gate closed for a wrong token and still refuses to cache it", async () => {
    process.env = { ...origEnv, ANTHROPIC_API_KEY: "test-key", HEALTH_DETAIL_TOKEN: "secret" };

    const res = await GET(makeRequest({ authorization: "Bearer wrong" }));
    expect(await res.json()).not.toHaveProperty("checks");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("cycles probe caching", () => {
  const realHealth = jest.requireActual("@/lib/ic/health") as typeof import("@/lib/ic/health");

  beforeEach(() => {
    realHealth._resetCyclesCache();
    realHealth._resetReachableCache();
    fetchMock.mockReset();
  });

  it("reuses a reachability answer inside its window", async () => {
    fetchMock.mockResolvedValue({ status: 400, ok: false });

    await realHealth.checkIcCanisterReachable("[test]");
    await realHealth.checkIcCanisterReachable("[test]");
    await realHealth.checkIcCanisterReachable("[test]");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-probes reachability once the window has passed", async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockResolvedValue({ status: 400, ok: false });
      await realHealth.checkIcCanisterReachable("[test]");

      jest.setSystemTime(new Date(Date.now() + 31_000));
      await realHealth.checkIcCanisterReachable("[test]");

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
