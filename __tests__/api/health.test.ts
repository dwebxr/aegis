import { GET } from "@/app/api/health/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/health", { method: "GET" });
}

const fetchMock = jest.fn();
global.fetch = fetchMock;

describe("GET /api/health", () => {
  const origEnv = process.env;

  beforeEach(() => {
    _resetRateLimits();
    // Default: IC canister reachable (400 = expected with empty CBOR body)
    fetchMock.mockResolvedValue({ status: 400, ok: false });
  });

  afterEach(() => {
    process.env = origEnv;
    fetchMock.mockReset();
  });

  it("returns 200 with status and checks", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(["ok", "degraded"]).toContain(data.status);
    expect(typeof data.checks).toBe("object");
    expect(data.checks).not.toBeNull();
  });

  it("returns valid ISO timestamp", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(typeof data.timestamp).toBe("string");
    const parsed = Date.parse(data.timestamp);
    expect(isNaN(parsed)).toBe(false);
  });

  it("returns version string", async () => {
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

  it("reports 'degraded' when ANTHROPIC_API_KEY is missing", async () => {
    process.env = { ...origEnv };
    delete process.env.ANTHROPIC_API_KEY;
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.status).toBe("degraded");
    expect(data.checks.anthropicKey).toBe("missing");
  });

  it("reports 'ok' when all checks pass", async () => {
    process.env = { ...origEnv, ANTHROPIC_API_KEY: "sk-test-key", NEXT_PUBLIC_SENTRY_DSN: "https://test@sentry.io/1" };
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.checks.anthropicKey).toBe("configured");
    expect(data.checks.icCanister).toBe("reachable");
    expect(data.checks.sentryDsn).toBe("configured");
  });

  it("reports 'degraded' when SENTRY_DSN is missing", async () => {
    process.env = { ...origEnv, ANTHROPIC_API_KEY: "sk-test-key" };
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.status).toBe("degraded");
    expect(data.checks.sentryDsn).toBe("missing");
  });

  it("reports kvStore status", async () => {
    process.env = { ...origEnv, KV_REST_API_URL: "https://kv.vercel.com" };
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.checks.kvStore).toBe("configured");
  });

  it("reports kvStore missing without KV_REST_API_URL", async () => {
    process.env = { ...origEnv };
    delete process.env.KV_REST_API_URL;
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.checks.kvStore).toBe("missing (budget per-instance)");
  });

  it("reports 'degraded' when IC canister is unreachable", async () => {
    process.env = { ...origEnv, ANTHROPIC_API_KEY: "sk-test-key", NEXT_PUBLIC_SENTRY_DSN: "https://test@sentry.io/1" };
    fetchMock.mockRejectedValue(new Error("Connection refused"));
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.status).toBe("degraded");
    expect(data.checks.icCanister).toBe("unreachable");
  });

  it("reports IC error on non-400/non-OK response", async () => {
    process.env = { ...origEnv, ANTHROPIC_API_KEY: "sk-test-key", NEXT_PUBLIC_SENTRY_DSN: "https://test@sentry.io/1" };
    fetchMock.mockResolvedValue({ status: 500, ok: false });
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.checks.icCanister).toBe("error (500)");
    expect(data.status).toBe("degraded");
  });

  it("includes node version and region", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.node).toBe(process.version);
    expect(data.region).toBe("local");
  });

  it("enforces rate limiting", async () => {
    for (let i = 0; i < 60; i++) {
      await GET(makeRequest());
    }
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
  });
});
