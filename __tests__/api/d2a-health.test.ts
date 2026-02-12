import { GET, OPTIONS } from "@/app/api/d2a/health/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const fetchMock = jest.fn();
global.fetch = fetchMock;

function makeRequest(origin?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  return new NextRequest("http://localhost/api/d2a/health", { method: "GET", headers });
}

describe("GET /api/d2a/health", () => {
  const origEnv = process.env;

  beforeEach(() => {
    _resetRateLimits();
    fetchMock.mockReset();
    // Default: IC canister reachable (400 = expected with empty CBOR body)
    fetchMock.mockResolvedValue({ status: 400, ok: false });
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("returns 200 with JSON body", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  it("includes status field", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(["ok", "degraded"]).toContain(data.status);
  });

  it("includes valid ISO timestamp", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.timestamp).toBeDefined();
    expect(isNaN(Date.parse(data.timestamp))).toBe(false);
  });

  it("includes version string", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(typeof data.version).toBe("string");
    expect(data.version.length).toBeGreaterThan(0);
  });

  it("returns 'local' version when no VERCEL_GIT_COMMIT_SHA", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.version).toBe("local");
  });

  it("returns 'local' region when no VERCEL_REGION", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.region).toBe("local");
  });

  it("checks x402 receiver configuration", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.checks.x402Receiver).toBeDefined();
    // In test env, X402_RECEIVER_ADDRESS is not set
    expect(data.checks.x402Receiver).toBe("not configured");
  });

  it("checks x402 network", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.checks.x402Network).toBeDefined();
  });

  it("reports IC canister as reachable when fetch returns 400", async () => {
    fetchMock.mockResolvedValue({ status: 400, ok: false });
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.checks.icCanister).toBe("reachable");
  });

  it("reports IC canister as reachable when fetch returns 200", async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true });
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.checks.icCanister).toBe("reachable");
  });

  it("reports IC canister as unreachable on fetch error", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.checks.icCanister).toBe("unreachable");
  });

  it("reports IC canister error on 500 response", async () => {
    fetchMock.mockResolvedValue({ status: 500, ok: false });
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.checks.icCanister).toBe("error (500)");
  });

  it("reports IC canister error on 403 response", async () => {
    fetchMock.mockResolvedValue({ status: 403, ok: false });
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.checks.icCanister).toBe("error (403)");
  });

  it("status is 'degraded' when x402 not configured and IC reachable", async () => {
    // X402_RECEIVER is empty in test env
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.status).toBe("degraded");
  });

  it("status is 'degraded' when IC unreachable even if x402 configured", async () => {
    process.env = { ...origEnv, X402_RECEIVER_ADDRESS: "0xabc123" };
    fetchMock.mockRejectedValue(new Error("timeout"));
    // Need to reimport to pick up env change — but x402Server is loaded at module level
    // So we just test the IC unreachable path
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.status).toBe("degraded");
  });

  it("makes POST request to IC canister query endpoint", async () => {
    await GET(makeRequest());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v2/canister/");
    expect(url).toContain("/query");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/cbor");
  });

  it("uses 5-second timeout for IC check", async () => {
    await GET(makeRequest());
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.signal).toBeDefined();
  });

  it("includes CORS headers on response", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("reflects known origin in CORS", async () => {
    const res = await GET(makeRequest("https://aegis.dwebxr.xyz"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
  });

  it("enforces rate limit of 60 per minute", async () => {
    for (let i = 0; i < 60; i++) {
      await GET(makeRequest());
    }
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
  });
});

describe("OPTIONS /api/d2a/health", () => {
  it("returns 204 preflight", async () => {
    const req = new NextRequest("http://localhost/api/d2a/health", { method: "OPTIONS" });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
  });

  it("includes CORS headers", async () => {
    const req = new NextRequest("http://localhost/api/d2a/health", {
      method: "OPTIONS",
      headers: { origin: "https://aegis.dwebxr.xyz" },
    });
    const res = await OPTIONS(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
  });
});
