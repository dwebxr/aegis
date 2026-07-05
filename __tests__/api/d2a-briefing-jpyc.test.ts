/**
 * /api/d2a/briefing-jpyc — OpenPay (x402 v1) JPYC gate.
 *
 * The gate reads env at module load, so every scenario builds a fresh module
 * graph via loadRoute() after arranging process.env + the global fetch mock.
 * briefingProvider is mocked (same pattern as d2a-briefing.test.ts); OpenPay
 * discovery/verify/settle are exercised through the fetch mock.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/d2a/briefingProvider", () => ({
  getLatestBriefing: jest.fn(),
  getGlobalBriefingSummaries: jest.fn(),
}));

const MERCHANT = "0x52d4901142e2B5680027da5EB47C86CB02a3cA81";
const JPYC_ASSET = "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29";
const RESOURCE = "https://aegis-ai.xyz/api/d2a/briefing-jpyc";
const PRINCIPAL = "rluf3-eiaaa-aaaam-qgjuq-cai";

const sampleBriefing = {
  version: "1.0" as const,
  generatedAt: "2025-01-01T00:00:00.000Z",
  source: "aegis" as const,
  sourceUrl: "https://aegis.dwebxr.xyz" as const,
  summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
  items: [{
    title: "Test Article",
    content: "Full content of test article",
    source: "rss",
    sourceUrl: "https://example.com",
    scores: { originality: 7, insight: 8, credibility: 6, composite: 7 },
    verdict: "quality" as const,
    reason: "Good",
    topics: ["tech"],
    briefingScore: 85,
  }],
  serendipityPick: null,
  meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: null, topics: ["tech"] },
};

function makeAccept(overrides: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: "eip155:137",
    maxAmountRequired: "2000000000000000000",
    resource: RESOURCE,
    description: "Aegis JPYC briefing",
    mimeType: "application/json",
    payTo: "0x0F4560a777415580F0680F8B56a79B0022C6B848",
    maxTimeoutSeconds: 600,
    asset: JPYC_ASSET,
    extra: {
      name: "JPY Coin",
      version: "1",
      decimals: 18,
      assetTransferMethod: "eip3009",
      openpay: { mode: "forwarder-split", merchant: MERCHANT },
    },
    ...overrides,
  };
}

function makeDiscovery(accepts: unknown[] = [makeAccept()], resource: string = RESOURCE) {
  return { x402Version: 1, items: [{ resource, accepts }] };
}

type FetchHandlers = {
  discovery?: () => Promise<Response> | Response;
  verify?: () => Promise<Response> | Response;
  settle?: () => Promise<Response> | Response;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock(handlers: FetchHandlers): jest.Mock {
  const mock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/discovery")) {
      return handlers.discovery ? handlers.discovery() : jsonResponse(makeDiscovery());
    }
    if (url.endsWith("/api/facilitator/verify")) {
      return handlers.verify ? handlers.verify() : jsonResponse({ isValid: true });
    }
    if (url.endsWith("/api/facilitator/settle")) {
      return handlers.settle
        ? handlers.settle()
        : jsonResponse({ success: true, transaction: "0xabc" });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function paymentHeader(payload: unknown = { x402Version: 1, scheme: "exact", payload: { sig: "0x1" } }): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function makeRequest(params?: Record<string, string>, headers?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/d2a/briefing-jpyc");
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: "GET", headers: headers ?? {} });
}

/** jest.resetModules() gives the route a FRESH briefingProvider mock instance,
 *  so the mock must be configured on the new registry's copy — a top-level
 *  imported binding would silently point at the stale pre-reset instance. */
async function loadRoute(briefing: unknown = sampleBriefing) {
  jest.resetModules();
  const provider = await import("@/lib/d2a/briefingProvider");
  (provider.getLatestBriefing as jest.Mock).mockResolvedValue(briefing);
  const rateLimit = await import("@/lib/api/rateLimit");
  rateLimit._resetRateLimits();
  return await import("@/app/api/d2a/briefing-jpyc/route");
}

const realFetch = global.fetch;
const origEnv = { ...process.env };

beforeEach(() => {
  process.env.OPENPAY_MERCHANT_ADDRESS = MERCHANT;
  delete process.env.OPENPAY_URL;
  delete process.env.OPENPAY_RESOURCE_URL;
  delete process.env.OPENPAY_JPYC_ASSET;
  delete process.env.X402_FREE_TIER_ENABLED;
});

afterEach(() => {
  global.fetch = realFetch;
  process.env = { ...origEnv };
});

describe("GET /api/d2a/briefing-jpyc — gate preconditions", () => {
  it("503s when the merchant address is not configured", async () => {
    delete process.env.OPENPAY_MERCHANT_ADDRESS;
    const fetchMock = installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("merchant not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503s when OPENPAY_URL is not https", async () => {
    process.env.OPENPAY_URL = "ftp://open-pay.jp";
    installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("URL misconfigured");
  });

  it("503s when the resource is not registered in the catalog", async () => {
    installFetchMock({ discovery: () => jsonResponse(makeDiscovery([makeAccept()], "https://open-pay.jp/api/paid/demo")) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("OpenPay resource not available");
  });

  it("503s when discovery returns 5xx", async () => {
    installFetchMock({ discovery: () => jsonResponse({ error: "down" }, 502) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
  });

  it("503s when discovery returns non-JSON", async () => {
    installFetchMock({ discovery: () => new Response("<html>oops</html>", { status: 200 }) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
  });

  it("503s when discovery times out (network reject)", async () => {
    installFetchMock({ discovery: () => Promise.reject(new DOMException("timeout", "TimeoutError")) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
  });

  it("503s when the catalog entry has empty accepts", async () => {
    installFetchMock({ discovery: () => jsonResponse(makeDiscovery([])) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
  });

  it("filters out wrong-network / wrong-asset / wrong-merchant / wrong-resource accepts (all invalid → 503)", async () => {
    installFetchMock({
      discovery: () => jsonResponse(makeDiscovery([
        makeAccept({ network: "eip155:8453" }),
        makeAccept({ asset: "0x0000000000000000000000000000000000000001" }),
        makeAccept({ extra: { openpay: { merchant: "0x0000000000000000000000000000000000000002" } } }),
        // The requirement the wallet authorizes must be bound to THIS resource —
        // an accept pointing elsewhere (or missing resource) is rejected even
        // though the enclosing catalog item matched.
        makeAccept({ resource: "https://open-pay.jp/api/paid/demo" }),
        makeAccept({ resource: undefined }),
        // Structurally incomplete requirements a wallet couldn't pay against
        makeAccept({ payTo: undefined }),
        makeAccept({ maxAmountRequired: "not-a-number" }),
        makeAccept({ maxTimeoutSeconds: undefined }),
        makeAccept({ description: undefined }),
        makeAccept({ mimeType: undefined }),
      ])),
    });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
  });

  it("503s (not 500) when the catalog item's accepts is malformed (non-array)", async () => {
    installFetchMock({
      discovery: () => jsonResponse({
        x402Version: 1,
        items: [{ resource: RESOURCE, accepts: { not: "an array" } }],
      }),
    });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("OpenPay resource not available");
  });

  it("serves exactly ONE validated accept in the 402 even when several pass", async () => {
    const first = makeAccept({ maxAmountRequired: "1000000000000000000" });
    installFetchMock({ discovery: () => jsonResponse(makeDiscovery([first, makeAccept()])) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0].maxAmountRequired).toBe("1000000000000000000");
  });

  it("tolerates a trailing slash in OPENPAY_URL (no // in facilitator paths)", async () => {
    process.env.OPENPAY_URL = "https://open-pay.jp/";
    const fetchMock = installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    expect(res.status).toBe(200);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("jp//");
    }
  });

  it("caches discovery within the TTL (second request does not re-fetch)", async () => {
    const fetchMock = installFetchMock({
      verify: () => jsonResponse({ isValid: false, invalidReason: "nope" }),
    });
    const { GET } = await loadRoute();
    await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    const discoveryCalls = fetchMock.mock.calls.filter(c => String(c[0]).endsWith("/api/discovery"));
    expect(discoveryCalls).toHaveLength(1);
  });
});

describe("GET /api/d2a/briefing-jpyc — payment flow", () => {
  it("402s with accepts and payment_required when X-PAYMENT is missing", async () => {
    installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.x402Version).toBe(1);
    expect(body.error).toBe("payment_required");
    expect(body.accepts[0].asset).toBe(JPYC_ASSET);
  });

  it("402s on an oversized X-PAYMENT header without calling the facilitator", async () => {
    const fetchMock = installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": "A".repeat(17 * 1024) }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("invalid_payment_payload");
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes("/facilitator/"))).toBe(false);
  });

  it("402s on malformed base64/JSON payload", async () => {
    installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": "!!!not-base64-json!!!" }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("invalid_payment_payload");
  });

  it("402s on a non-object JSON payload", async () => {
    installFetchMock({});
    const { GET } = await loadRoute();
    const header = Buffer.from(JSON.stringify([1, 2, 3])).toString("base64");
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": header }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("invalid_payment_payload");
  });

  it("402s with the facilitator's invalidReason when verify rejects", async () => {
    installFetchMock({ verify: () => jsonResponse({ isValid: false, invalidReason: "authorization_expired" }) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("authorization_expired");
  });

  it("402s with generic payment_invalid when verify returns non-JSON", async () => {
    installFetchMock({ verify: () => new Response("boom", { status: 500 }) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("payment_invalid");
  });

  it("402s when verify times out (network reject)", async () => {
    installFetchMock({ verify: () => Promise.reject(new DOMException("timeout", "TimeoutError")) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("payment_invalid");
  });

  it("does NOT settle when content build fails (404) — failed requests are never charged", async () => {
    const fetchMock = installFetchMock({});
    const { GET } = await loadRoute(null);
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    expect(res.status).toBe(404);
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith("/facilitator/settle"))).toBe(false);
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith("/facilitator/verify"))).toBe(true);
  });

  it("does NOT settle on an invalid principal (400 from content build)", async () => {
    const fetchMock = installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: "not-a-principal" }, { "x-payment": paymentHeader() }));
    expect(res.status).toBe(400);
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith("/facilitator/settle"))).toBe(false);
  });

  it("402s with the facilitator's errorReason when settle fails (content discarded)", async () => {
    installFetchMock({ settle: () => jsonResponse({ success: false, errorReason: "nonce_used" }) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("nonce_used");
  });

  it("402s with settlement_failed when settle returns non-JSON", async () => {
    installFetchMock({ settle: () => new Response("boom", { status: 502 }) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("settlement_failed");
  });

  it("never retries settle (single attempt even on failure)", async () => {
    const fetchMock = installFetchMock({ settle: () => Promise.reject(new DOMException("timeout", "TimeoutError")) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    expect(res.status).toBe(402);
    const settleCalls = fetchMock.mock.calls.filter(c => String(c[0]).endsWith("/facilitator/settle"));
    expect(settleCalls).toHaveLength(1);
  });

  it("returns 200 + X-PAYMENT-RESPONSE on a fully successful payment", async () => {
    installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    expect(res.status).toBe(200);
    const receipt = res.headers.get("X-PAYMENT-RESPONSE");
    expect(receipt).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(receipt!, "base64").toString("utf8"));
    expect(decoded.success).toBe(true);
    const body = await res.json();
    expect(body.items[0].title).toBe("Test Article");
  });

  it("relays the paymentRequirements the client saw to verify and settle (same accept object)", async () => {
    const fetchMock = installFetchMock({});
    const { GET } = await loadRoute();
    await GET(makeRequest({ principal: PRINCIPAL }, { "x-payment": paymentHeader() }));
    const verifyBody = JSON.parse(String(fetchMock.mock.calls.find(c => String(c[0]).endsWith("/verify"))![1]!.body));
    const settleBody = JSON.parse(String(fetchMock.mock.calls.find(c => String(c[0]).endsWith("/settle"))![1]!.body));
    expect(verifyBody.x402Version).toBe(1);
    expect(verifyBody.paymentRequirements).toEqual(settleBody.paymentRequirements);
    expect(verifyBody.paymentRequirements.asset).toBe(JPYC_ASSET);
  });
});

describe("GET /api/d2a/briefing-jpyc — headers and bypass", () => {
  it("applies CORS + no-store to 402 responses", async () => {
    installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(402);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("applies CORS + no-store to 503 responses", async () => {
    delete process.env.OPENPAY_MERCHANT_ADDRESS;
    installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("bypasses the gate for preview=true when the free tier is enabled", async () => {
    process.env.X402_FREE_TIER_ENABLED = "true";
    const fetchMock = installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL, preview: "true" }));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    // applyPreview truncates content (same semantics as /api/d2a/briefing)
    const body = await res.json();
    expect(body.items[0].title).toBe("Test Article");
  });

  it("does NOT bypass for preview=true when the free tier is disabled", async () => {
    installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL, preview: "true" }));
    expect(res.status).toBe(402);
  });

  it("OPTIONS returns 204 with CORS headers", async () => {
    installFetchMock({});
    const { OPTIONS } = await loadRoute();
    const res = await OPTIONS(new NextRequest("http://localhost/api/d2a/briefing-jpyc", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-PAYMENT");
  });

  it("enforces the 30/min rate limit before any facilitator traffic", async () => {
    const fetchMock = installFetchMock({});
    const { GET } = await loadRoute();
    for (let i = 0; i < 30; i++) {
      await GET(makeRequest({ principal: PRINCIPAL }));
    }
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(429);
    // 31st request must not have produced a 31st discovery call chain
    const discoveryCalls = fetchMock.mock.calls.filter(c => String(c[0]).endsWith("/api/discovery"));
    expect(discoveryCalls.length).toBeLessThanOrEqual(1); // cached after the first anyway
  });
});
