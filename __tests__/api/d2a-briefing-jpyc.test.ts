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
const RESOURCE_ID = "158883b0-b76d-432d-a89e-577b583a0f5d";
const FORWARDER = "0x0F4560a777415580F0680F8B56a79B0022C6B848";
const DISCOVERY_URL = `https://open-pay.jp/api/discovery/${RESOURCE_ID}`;
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
    payTo: FORWARDER,
    maxTimeoutSeconds: 600,
    asset: JPYC_ASSET,
    extra: {
      name: "JPY Coin",
      version: "1",
      decimals: 18,
      assetTransferMethod: "eip3009",
      openpay: { mode: "forwarder-split", forwarder: FORWARDER, merchant: MERCHANT },
    },
    ...overrides,
  };
}

function makeDiscovery(accepts: unknown[] = [makeAccept()], resource: string = RESOURCE) {
  return { id: RESOURCE_ID, resource, accepts };
}

function makeSplitAccept(overrides: Record<string, unknown>) {
  const accept = makeAccept();
  return makeAccept({
    extra: { ...accept.extra, openpay: { ...accept.extra.openpay, ...overrides } },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

type FetchHandlers = {
  discovery?: (init?: RequestInit) => Promise<Response> | Response;
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
  const mock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === DISCOVERY_URL) {
      return handlers.discovery ? handlers.discovery(init) : jsonResponse(makeDiscovery());
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
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  process.env.OPENPAY_MERCHANT_ADDRESS = MERCHANT;
  process.env.OPENPAY_RESOURCE_ID = RESOURCE_ID;
  delete process.env.OPENPAY_USDC_RAIL_ENABLED;
  delete process.env.OPENPAY_URL;
  delete process.env.OPENPAY_RESOURCE_URL;
  delete process.env.OPENPAY_JPYC_ASSET;
  delete process.env.X402_FREE_TIER_ENABLED;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
  process.env = { ...origEnv };
});

describe("GET /api/d2a/briefing-jpyc — gate preconditions", () => {
  it.each([undefined, "", "   ", "bad"])("503s paid requests without fetching for resourceId %p, but previews work", async (id) => {
    if (id === undefined) delete process.env.OPENPAY_RESOURCE_ID;
    else process.env.OPENPAY_RESOURCE_ID = id;
    process.env.X402_FREE_TIER_ENABLED = "true";
    const fetchMock = installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("OpenPay resource id missing or malformed");
    expect((await GET(makeRequest({ principal: PRINCIPAL, preview: "true" }))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["OPENPAY_MERCHANT_ADDRESS", "not-an-address", "OpenPay merchant address malformed"],
    ["OPENPAY_RESOURCE_URL", `${RESOURCE}/`, "OpenPay resource URL non-canonical"],
    ["OPENPAY_RESOURCE_URL", `${RESOURCE}?x=1`, "OpenPay resource URL non-canonical"],
    ["OPENPAY_RESOURCE_URL", `${RESOURCE}#fragment`, "OpenPay resource URL non-canonical"],
    ["OPENPAY_RESOURCE_URL", "https://aegis-ai.xyz:443/api/d2a/briefing-jpyc", "OpenPay resource URL non-canonical"],
    ["OPENPAY_RESOURCE_URL", "https://AEGIS-AI.XYZ/api/d2a/briefing-jpyc", "OpenPay resource URL non-canonical"],
  ])("503s without fetching for invalid %s = %s", async (key, value, error) => {
    process.env[key] = value;
    process.env.X402_FREE_TIER_ENABLED = "true";
    const fetchMock = installFetchMock({});
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(error);
    expect((await GET(makeRequest({ principal: PRINCIPAL, preview: "true" }))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([RESOURCE_ID, RESOURCE_ID.toUpperCase()])("fetches the lowercase pinned ID for %s and preserves addresses and extra fields", async (id) => {
    process.env.OPENPAY_RESOURCE_ID = ` ${id} `;
    const accept = makeAccept({ walletExtension: { supported: true } });
    const fetchMock = installFetchMock({ discovery: () => jsonResponse(makeDiscovery([accept])) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(402);
    expect((await res.json()).accepts).toEqual([accept]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(DISCOVERY_URL, {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    const gate = await import("@/lib/d2a/openpayGate");
    expect(gate.OPENPAY_RESOURCE_ID).toBe(RESOURCE_ID);
    expect(gate.OPENPAY_MERCHANT).toBe(MERCHANT.toLowerCase());
  });

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

  it.each([
    ["wrong id", { ...makeDiscovery(), id: "258883b0-b76d-432d-a89e-577b583a0f5d" }],
    ["resource trailing slash", makeDiscovery([makeAccept()], `${RESOURCE}/`)],
    ["resource query", makeDiscovery([makeAccept()], `${RESOURCE}?x=1`)],
    ["null", null],
    ["array", [makeDiscovery()]],
    ["primitive", "listing"],
    ["accepts non-array", { ...makeDiscovery(), accepts: {} }],
    ["empty accepts", makeDiscovery([])],
  ])("503s for a listing with %s", async (_name, listing) => {
    const fetchMock = installFetchMock({ discovery: () => jsonResponse(listing) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("OpenPay resource not available");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["spoofed merchant", makeSplitAccept({ merchant: "0x0000000000000000000000000000000000000002" })],
    ["malformed merchant", makeSplitAccept({ merchant: "not-an-address" })],
    ["missing merchant", makeSplitAccept({ merchant: undefined })],
    ["payTo differs from forwarder", makeAccept({ payTo: MERCHANT })],
    ["payTo missing", makeAccept({ payTo: undefined })],
    ["payTo malformed", makeAccept({ payTo: "not-an-address" })],
    ["wrong mode", makeSplitAccept({ mode: "direct" })],
    ["forwarder missing", makeSplitAccept({ forwarder: undefined })],
    // Both addresses normalize to null; this needs the explicit forwarder guard.
    ["forwarder missing and payTo malformed", { ...makeSplitAccept({ forwarder: undefined }), payTo: "not-an-address" }],
    ["forwarder malformed", makeSplitAccept({ forwarder: "not-an-address" })],
    ["split missing", makeAccept({ extra: {} })],
    ["split array", makeAccept({ extra: { openpay: [] } })],
    ["accept null", null],
    ["accept array", []],
  ])("rejects the whole listing for %s even after a valid accept", async (_name, badAccept) => {
    const fetchMock = installFetchMock({ discovery: () => jsonResponse(makeDiscovery([makeAccept(), badAccept])) });
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({ principal: PRINCIPAL }))).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[openpay-jpyc] listing rejected:"));
  });

  // payTo is covered above: missing/invalid values also violate the trust pins.
  it.each([
    ["network", "eip155:8453"],
    ["network", undefined],
    ["asset", "0x0000000000000000000000000000000000000001"],
    ["asset", undefined],
    ["asset", 1],
    ["scheme", "upto"],
    ["scheme", undefined],
    ["resource", "https://open-pay.jp/api/paid/demo"],
    ["resource", `${RESOURCE}/`],
    ["resource", `${RESOURCE}?x=1`],
    ["resource", undefined],
    ["maxAmountRequired", undefined],
    ["maxAmountRequired", "not-a-number"],
    ["maxAmountRequired", ""],
    ["maxAmountRequired", "-1"],
    ["maxAmountRequired", "1.5"],
    ["maxAmountRequired", 1],
    ["description", undefined],
    ["description", 1],
    ["mimeType", undefined],
    ["mimeType", 1],
    ["maxTimeoutSeconds", undefined],
    ["maxTimeoutSeconds", "600"],
    ["maxTimeoutSeconds", 0],
    ["maxTimeoutSeconds", -1],
    ["maxTimeoutSeconds", 1.5],
  ])("503s for trust-valid accepts with structural fault %s = %p", async (field, value) => {
    const fetchMock = installFetchMock({ discovery: () => jsonResponse(makeDiscovery([makeAccept({ [field as string]: value })])) });
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({ principal: PRINCIPAL }))).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("[openpay-jpyc] listing rejected: no valid payment requirements");
  });

  it("selects the second accept when the first is trust-valid but structurally invalid", async () => {
    const second = makeAccept();
    const fetchMock = installFetchMock({ discovery: () => jsonResponse(makeDiscovery([makeAccept({ network: "eip155:8453" }), second])) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(402);
    expect((await res.json()).accepts).toEqual([second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([[16, 402], [17, 503]])("handles %i accepts with status %i", async (count, status) => {
    const fetchMock = installFetchMock({ discovery: () => jsonResponse(makeDiscovery(Array.from({ length: count }, () => makeAccept()))) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ principal: PRINCIPAL }));
    expect(res.status).toBe(status);
    if (status === 402) expect((await res.json()).accepts).toEqual([makeAccept()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["oversized body with a valid JSON prefix", () => new Response(JSON.stringify(makeDiscovery()) + " ".repeat(512 * 1024))],
    ["404", () => jsonResponse(makeDiscovery(), 404)],
    ["no body", () => new Response(null)],
    ["unreadable body", () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("broken stream")); },
    }))],
  ])("503s on %s and retries discovery on the next request", async (_name, discovery) => {
    let first = true;
    const fetchMock = installFetchMock({ discovery: () => {
      if (!first) return jsonResponse(makeDiscovery());
      first = false;
      return discovery();
    } });
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({ principal: PRINCIPAL }))).status).toBe(503);
    expect((await GET(makeRequest({ principal: PRINCIPAL }))).status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects raw JSON nested 12,000 levels deep without throwing or caching", async () => {
    // Construct raw JSON: JSON.stringify of a deeply nested object would itself throw.
    const deep = '{"child":'.repeat(12_000) + "null" + "}".repeat(12_000);
    const accept = JSON.stringify(makeAccept()).slice(0, -1) + `,"extension":${deep}}`;
    const raw = `{"id":"${RESOURCE_ID}","resource":"${RESOURCE}","accepts":[${JSON.stringify(makeAccept())},${accept}]}`;
    let first = true;
    const fetchMock = installFetchMock({ discovery: () => {
      if (!first) return jsonResponse(makeDiscovery());
      first = false;
      return new Response(raw);
    } });
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({ principal: PRINCIPAL }))).status).toBe(503);
    expect(warnSpy).toHaveBeenCalledWith("[openpay-jpyc] listing rejected: accept nested too deeply");
    expect((await GET(makeRequest({ principal: PRINCIPAL }))).status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("503s when a hung discovery fetch is aborted at the timeout", async () => {
    jest.useFakeTimers();
    const timeout = jest.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), milliseconds);
      return controller.signal;
    });
    const started = deferred<void>();
    const fetchMock = installFetchMock({ discovery: init => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
      started.resolve();
    }) });
    const { GET } = await loadRoute();
    const pending = GET(makeRequest({ principal: PRINCIPAL }));
    await started.promise;
    await jest.advanceTimersByTimeAsync(5_000);
    expect((await pending).status).toBe(503);
    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("coalesces concurrent cold misses into one discovery fetch", async () => {
    const discovery = deferred<Response>();
    const started = deferred<void>();
    const fetchMock = installFetchMock({ discovery: () => {
      started.resolve();
      return discovery.promise;
    } });
    const { GET } = await loadRoute();
    const requests = Array.from({ length: 3 }, () => GET(makeRequest({ principal: PRINCIPAL })));
    await started.promise;
    discovery.resolve(jsonResponse(makeDiscovery()));
    const responses = await Promise.all(requests);
    expect(responses.map(res => res.status)).toEqual([402, 402, 402]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not repopulate the cache with an in-flight result after reset", async () => {
    const stale = deferred<Response>();
    const current = deferred<Response>();
    const started = deferred<void>();
    const fresh = makeAccept({ maxAmountRequired: "3000000000000000000" });
    let first = true;
    const fetchMock = installFetchMock({ discovery: () => {
      if (!first) return current.promise;
      first = false;
      started.resolve();
      return stale.promise;
    } });
    const { GET } = await loadRoute();
    const { _resetOpenPayCache, fetchAccepts } = await import("@/lib/d2a/openpayGate");
    const pending = GET(makeRequest({ principal: PRINCIPAL }));
    await started.promise;
    _resetOpenPayCache();
    const next = fetchAccepts();
    stale.resolve(jsonResponse(makeDiscovery()));
    expect((await pending).status).toBe(402);
    const shared = fetchAccepts();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    current.resolve(jsonResponse(makeDiscovery([fresh])));
    expect(await next).toEqual([fresh]);
    expect(await shared).toEqual([fresh]);
    for (let i = 0; i < 2; i++) {
      const res = await GET(makeRequest({ principal: PRINCIPAL }));
      expect(res.status).toBe(402);
      expect((await res.json()).accepts).toEqual([fresh]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    const discoveryCalls = fetchMock.mock.calls.filter(c => String(c[0]) === DISCOVERY_URL);
    expect(discoveryCalls).toHaveLength(1);
  });

  it("does not reuse expired accepts when discovery fails and retries immediately", async () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    let available = true;
    const fetchMock = installFetchMock({ discovery: () => jsonResponse(makeDiscovery(), available ? 200 : 503) });
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({ principal: PRINCIPAL }))).status).toBe(402);
    now += 5 * 60_000;
    available = false;
    expect((await GET(makeRequest({ principal: PRINCIPAL }))).status).toBe(503);
    available = true;
    expect((await GET(makeRequest({ principal: PRINCIPAL }))).status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    const discoveryCalls = fetchMock.mock.calls.filter(c => String(c[0]) === DISCOVERY_URL);
    expect(discoveryCalls.length).toBeLessThanOrEqual(1); // cached after the first anyway
  });
});
