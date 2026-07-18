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
    expect(data.sourceUrl).toBe("https://aegis-ai.xyz");
  });

  it("lists briefing endpoint with receiver-derived auth (none when x402 unset)", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.briefing.url).toBe("/api/d2a/briefing");
    expect(data.endpoints.briefing.method).toBe("GET");
    // X402_RECEIVER is empty in test env → briefing is served free, so auth = "none".
    expect(data.endpoints.briefing.auth).toBe("none");
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

  it("lists the disabled-by-default score endpoint with its own price", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.score).toEqual(expect.objectContaining({
      url: "/api/d2a/score",
      method: "GET",
      auth: "disabled",
      x402Version: 2,
      price: "$0.02",
      network: "eip155:84532",
      currency: "USDC",
    }));
    expect(data.endpoints.score.params.url).toContain("required");
    expect(data.endpoints.score.params.url).toContain("access logs");
    expect(data.payment.priceNote).toContain("endpoints[].price");
  });

  it("includes payment section with x402 protocol", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.payment.protocol).toBe("x402");
    // Default network is eip155:84532 (Base Sepolia) → the advertised asset must
    // be the Sepolia USDC the paywall actually demands, not Base-mainnet USDC,
    // and the currency label comes from the same registry entry.
    expect(data.payment.network).toBe("eip155:84532");
    expect(data.payment.currency).toBe("USDC");
    expect(data.payment.asset).toEqual({
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      name: "USDC",
      decimals: 6,
    });
    expect(data.payment.usdcContract).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  });

  it("includes scoring model description", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.scoring.model).toBe("aegis-vcl-v1");
    expect(typeof data.scoring.axes.V_signal).toBe("string");
    expect(typeof data.scoring.axes.C_context).toBe("string");
    expect(typeof data.scoring.axes.L_slop).toBe("string");
  });

  it("includes legacy scoring axes", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(typeof data.scoring.legacy.originality).toBe("string");
    expect(typeof data.scoring.legacy.insight).toBe("string");
    expect(typeof data.scoring.legacy.credibility).toBe("string");
    expect(typeof data.scoring.legacy.composite).toBe("string");
  });

  it("includes compatibility info", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.compatibility.x402Version).toBe(2);
    expect(data.compatibility.erc8004).toBeUndefined();
  });

  it("omits CORS allow-origin for unknown origin", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
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

  it("briefing endpoint documents since param", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.briefing.params.since).toContain("ISO 8601");
  });

  it("briefing endpoint documents limit param", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.briefing.params.limit).toContain("max");
  });

  it("briefing endpoint documents offset param", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.briefing.params.offset).toContain("pagination");
  });

  it("briefing endpoint documents topics param", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.briefing.params.topics).toContain("comma-separated");
  });

  it("briefing endpoint documents preview param", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.briefing.params.preview).toContain("truncated");
  });

  it("lists changes endpoint with receiver-derived auth (none when x402 unset)", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.changes.url).toBe("/api/d2a/briefing/changes");
    expect(data.endpoints.changes.method).toBe("GET");
    // X402_RECEIVER is empty in test env → changes is served free, so auth = "none".
    // With a receiver configured the route is x402-wrapped, same as briefing.
    expect(data.endpoints.changes.auth).toBe("none");
    expect(data.endpoints.changes.price).toBe(data.endpoints.briefing.price);
    expect(data.endpoints.changes.network).toBe(data.endpoints.briefing.network);
  });

  it("changes endpoint documents required since param", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.changes.params.since).toContain("required");
  });

  it("changes endpoint documents preview param", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.changes.params.preview).toContain("redacted");
  });

  it("lists the JPYC briefing endpoint as OpenPay-flavored x402 v1", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    const jpyc = data.endpoints.briefingJpyc;
    expect(jpyc.url).toBe("/api/d2a/briefing-jpyc");
    expect(jpyc.method).toBe("GET");
    // OPENPAY_MERCHANT_ADDRESS is unset in the test env → the route 503s, so the
    // manifest must say "unavailable", not "none" (there is no free fallback).
    expect(jpyc.auth).toBe("unavailable");
    expect(jpyc.x402Version).toBe(1);
    expect(jpyc.network).toBe("eip155:137");
    expect(jpyc.currency).toBe("JPYC");
    // Price is catalog-driven — the manifest must not hardcode a value that drifts.
    expect(jpyc.price).toContain("OpenPay catalog");
    expect(jpyc.facilitator).toBe("https://open-pay.jp");
    expect(jpyc.description).toContain("vanilla x402 clients are not compatible");
  });

  it("marks x402 versions per endpoint and lists v1 endpoints in compatibility", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.endpoints.briefing.x402Version).toBe(2);
    expect(data.endpoints.changes.x402Version).toBe(2);
    expect(data.compatibility.x402Version).toBe(2);
    expect(data.compatibility.x402V1Endpoints).toEqual(["/api/d2a/briefing-jpyc"]);
  });
});

describe("GET /api/d2a/info with unsupported X402_NETWORK", () => {
  const origNetwork = process.env.X402_NETWORK;

  afterEach(() => {
    if (origNetwork === undefined) delete process.env.X402_NETWORK;
    else process.env.X402_NETWORK = origNetwork;
    jest.resetModules();
  });

  it("still serves 200 and reports the asset as unknown (no module-load throw)", async () => {
    // eip155:1 has no default asset in @x402/evm — the discovery route must keep
    // serving (it's free and auth-none) rather than crash at import time.
    process.env.X402_NETWORK = "eip155:1";
    jest.resetModules();
    const { GET: freshGET } = await import("@/app/api/d2a/info/route");
    const res = await freshGET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.payment.network).toBe("eip155:1");
    expect(data.payment.currency).toBe("unknown");
    expect(data.payment.asset).toBeNull();
    expect(data.payment.usdcContract).toBe("unknown");
  });
});

describe("GET /api/d2a/info with Base mainnet", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("advertises eip155:8453 USD Coin from the x402 asset registry", async () => {
    process.env.X402_NETWORK = "eip155:8453";
    process.env.CDP_API_KEY_ID = "test-key-id";
    process.env.CDP_API_KEY_SECRET = "test-key-secret";
    jest.doMock("@/lib/d2a/cdpFacilitator", () => ({
      createCdpFacilitatorConfig: () => ({ url: "https://cdp.test/x402" }),
    }));
    jest.resetModules();
    const { GET: mainnetGET } = await import("@/app/api/d2a/info/route");
    const res = await mainnetGET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.endpoints.score.network).toBe("eip155:8453");
    expect(data.endpoints.score.currency).toBe("USD Coin");
    expect(data.payment.asset).toEqual({
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      name: "USD Coin",
      decimals: 6,
    });
  });
});

describe("D2A score free-mode production fail-fast", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("throws while loading the info descriptor when production free mode is enabled", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      writable: true,
      configurable: true,
      enumerable: true,
    });
    process.env.D2A_SCORE_FREE_ENABLED = "true";
    jest.resetModules();
    await expect(import("@/app/api/d2a/info/route"))
      .rejects.toThrow("must not be enabled in production");
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
