/**
 * Tests for /api/health route.
 */
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = origEnv;
  });

  it("returns 200 with status and checks", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBeDefined();
    expect(data.checks).toBeDefined();
  });

  it("returns valid ISO timestamp", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.timestamp).toBeDefined();
    const parsed = Date.parse(data.timestamp);
    expect(isNaN(parsed)).toBe(false);
  });

  it("returns version string", async () => {
    const res = await GET();
    const data = await res.json();
    expect(typeof data.version).toBe("string");
    expect(data.version.length).toBeGreaterThan(0);
  });

  it("returns 'local' version when no VERCEL_GIT_COMMIT_SHA", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.version).toBe("local");
  });

  it("reports 'degraded' when ANTHROPIC_API_KEY is missing", async () => {
    process.env = { ...origEnv };
    delete process.env.ANTHROPIC_API_KEY;
    const res = await GET();
    const data = await res.json();
    expect(data.status).toBe("degraded");
    expect(data.checks.anthropicKey).toBe("missing");
  });

  it("reports 'ok' when ANTHROPIC_API_KEY is configured", async () => {
    process.env = { ...origEnv, ANTHROPIC_API_KEY: "sk-test-key" };
    const res = await GET();
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.checks.anthropicKey).toBe("configured");
  });

  it("includes node version and region", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.node).toBe(process.version);
    expect(data.region).toBe("local");
  });
});
