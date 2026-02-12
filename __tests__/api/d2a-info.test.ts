import { GET, OPTIONS } from "@/app/api/d2a/info/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

function makeRequest(origin?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  return new NextRequest("http://localhost/api/d2a/info", { method: "GET", headers });
}

describe("GET /api/d2a/info", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  it("returns 200 with JSON body", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  it("contains service name and description", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.name).toBe("Aegis");
    expect(data.description).toContain("D2A");
  });

  it("contains version field", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.version).toBe("1.0");
  });

  it("contains sourceUrl", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.sourceUrl).toBe("https://aegis.dwebxr.xyz");
  });

  it("lists briefing endpoint with x402 auth", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.briefing).toBeDefined();
    expect(data.endpoints.briefing.url).toBe("/api/d2a/briefing");
    expect(data.endpoints.briefing.method).toBe("GET");
    expect(data.endpoints.briefing.auth).toBe("x402");
  });

  it("lists info endpoint with no auth", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.info.url).toBe("/api/d2a/info");
    expect(data.endpoints.info.auth).toBe("none");
  });

  it("lists health endpoint with no auth", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.health.url).toBe("/api/d2a/health");
    expect(data.endpoints.health.auth).toBe("none");
  });

  it("includes payment section with x402 protocol", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.payment.protocol).toBe("x402");
    expect(data.payment.currency).toBe("USDC");
    expect(data.payment.usdcContract).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });

  it("includes scoring model description", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.scoring.model).toBe("aegis-vcl-v1");
    expect(data.scoring.axes.V_signal).toBeDefined();
    expect(data.scoring.axes.C_context).toBeDefined();
    expect(data.scoring.axes.L_slop).toBeDefined();
  });

  it("includes legacy scoring axes", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.scoring.legacy.originality).toBeDefined();
    expect(data.scoring.legacy.insight).toBeDefined();
    expect(data.scoring.legacy.credibility).toBeDefined();
    expect(data.scoring.legacy.composite).toBeDefined();
  });

  it("includes compatibility info", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.compatibility.erc8004).toBe(false);
    expect(data.compatibility.x402Version).toBe(2);
  });

  it("includes CORS headers", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("reflects known origin in CORS", async () => {
    const res = await GET(makeRequest("https://aegis.dwebxr.xyz"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
  });

  it("enforces rate limit of 60 per minute", async () => {
    for (let i = 0; i < 60; i++) {
      const r = await GET(makeRequest());
      expect(r.status).toBe(200);
    }
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
  });

  it("payment.receiver is string", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(typeof data.payment.receiver).toBe("string");
  });

  it("briefing endpoint describes optional principal param", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.briefing.params.principal).toContain("optional");
  });
});

describe("OPTIONS /api/d2a/info", () => {
  it("returns 204", async () => {
    const req = new NextRequest("http://localhost/api/d2a/info", { method: "OPTIONS" });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
  });

  it("includes CORS headers in preflight", async () => {
    const req = new NextRequest("http://localhost/api/d2a/info", {
      method: "OPTIONS",
      headers: { origin: "https://aegis.dwebxr.xyz" },
    });
    const res = await OPTIONS(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-PAYMENT");
  });
});
