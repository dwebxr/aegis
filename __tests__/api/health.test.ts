/**
 * Tests for /api/health route.
 */
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
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
    // In test env, VERCEL_GIT_COMMIT_SHA is not set
    expect(data.version).toBe("local");
  });
});
