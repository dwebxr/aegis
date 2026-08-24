/**
 * Opt-in OpenPay USDC rail. Every OpenPay call and KV operation is mocked;
 * this suite never reaches aegis-ai.xyz or open-pay.jp.
 */
import { NextRequest } from "next/server";

const mockOpenpayStore = new Map<string, unknown>();
const mockOpenpaySetOptions = new Map<string, unknown>();
const mockKvControl = {
  unavailable: false,
  claim: "normal" as "normal" | "exists" | "unavailable",
  finalWrite: "normal" as "normal" | "null" | "throw" | "hang",
};
const mockOpenpayPaymentKV = {
  get: jest.fn(async (key: string) => {
    if (mockKvControl.unavailable) return undefined;
    return mockOpenpayStore.has(key) ? mockOpenpayStore.get(key) : null;
  }),
  set: jest.fn(async (key: string, value: unknown, options?: { nx?: boolean; ex?: number }) => {
    if (mockKvControl.unavailable) return undefined;
    if (key.endsWith(":state") && options?.nx) {
      if (mockKvControl.claim === "unavailable") return undefined;
      if (mockKvControl.claim === "exists") return null;
    }
    if (key.endsWith(":state") && !options?.nx) {
      if (mockKvControl.finalWrite === "throw") throw new Error("KV write failed");
      if (mockKvControl.finalWrite === "null") return null;
      if (mockKvControl.finalWrite === "hang") return new Promise<never>(() => {});
    }
    if (options?.nx && mockOpenpayStore.has(key)) return null;
    mockOpenpayStore.set(key, value);
    mockOpenpaySetOptions.set(key, options);
    return "OK" as const;
  }),
  del: jest.fn(async (key: string) => {
    if (mockKvControl.unavailable) return undefined;
    const existed = mockOpenpayStore.delete(key);
    return existed ? 1 : 0;
  }),
  _store: mockOpenpayStore,
};
const mockRateLimitKV = {
  incr: jest.fn(async () => undefined),
  ttl: jest.fn(async () => undefined),
};
const mockCaptureMessage = jest.fn();
const mockCaptureException = jest.fn();

jest.mock("@/lib/api/kv/namespace", () => ({
  openpayPaymentKV: mockOpenpayPaymentKV,
  rateLimitKV: mockRateLimitKV,
}));
jest.mock("@/lib/observability", () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));
jest.mock("@/lib/d2a/briefingProvider", () => ({
  getLatestBriefing: jest.fn(),
  getGlobalBriefingSummaries: jest.fn(),
}));

const MERCHANT = "0x52d4901142e2B5680027da5EB47C86CB02a3cA81";
const ATTACKER = "0x00000000000000000000000000000000000000AA";
const FROM = "0xA100000000000000000000000000000000000001";
const OTHER_FROM = "0xb200000000000000000000000000000000000002";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const JPYC = "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29";
const RESOURCE = "https://aegis-ai.xyz/api/d2a/briefing-jpyc";
const RESOURCE_ID = "158883b0-b76d-432d-a89e-577b583a0f5d";
const PRINCIPAL = "rluf3-eiaaa-aaaam-qgjuq-cai";
const TRANSACTION = `0x${"ab".repeat(32)}`;

const sampleBriefing = {
  version: "1.0" as const,
  generatedAt: "2025-01-01T00:00:00.000Z",
  source: "aegis" as const,
  sourceUrl: "https://aegis-ai.xyz" as const,
  summary: { totalEvaluated: 1, totalBurned: 0, qualityRate: 1 },
  items: [{
    title: "USDC test",
    content: "paid content",
    source: "rss",
    sourceUrl: "https://example.com/article",
    scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
    verdict: "quality" as const,
    reason: "useful",
    topics: ["payments"],
    briefingScore: 90,
  }],
  serendipityPick: null,
  meta: { scoringModel: "aegis-vcl-v1", nostrPubkey: null, topics: ["payments"] },
};

interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

interface FaceRecord {
  resourceId: string;
  v1Accepts: Record<string, unknown>;
  v2Accept: Record<string, unknown>;
  paymentRequiredHeader: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function base64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

function makeJpycAccept(): Record<string, unknown> {
  return {
    scheme: "exact",
    network: "eip155:137",
    asset: JPYC,
    payTo: "0x1111111111111111111111111111111111111111",
    maxAmountRequired: "1000000000000000000",
    resource: RESOURCE,
    description: "Aegis briefing",
    mimeType: "application/json",
    maxTimeoutSeconds: 300,
    extra: { openpay: { merchant: MERCHANT } },
  };
}

function makeDiscovery(): Record<string, unknown> {
  return {
    x402Version: 1,
    items: [{ resource: RESOURCE, accepts: [makeJpycAccept()] }],
  };
}

function requiredHeader(v2Accept: Record<string, unknown>): string {
  return base64({
    x402Version: 2,
    resource: {
      url: RESOURCE,
      description: "Aegis briefing",
      mimeType: "application/json",
    },
    accepts: [v2Accept],
    error: "payment_required",
    extensions: { bazaar: { info: { category: "content" } } },
  });
}

function makeFace(): FaceRecord {
  const v1Accepts = {
    scheme: "exact",
    network: "base",
    maxAmountRequired: "6000",
    resource: RESOURCE,
    description: "Aegis briefing",
    mimeType: "application/json",
    payTo: MERCHANT,
    maxTimeoutSeconds: 300,
    asset: USDC,
    extra: { name: "USD Coin", version: "2" },
  };
  const v2Accept = {
    scheme: "exact",
    network: "eip155:8453",
    amount: "6000",
    asset: USDC,
    payTo: MERCHANT,
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  };
  return {
    resourceId: RESOURCE_ID,
    v1Accepts,
    v2Accept,
    paymentRequiredHeader: requiredHeader(v2Accept),
  };
}

function makeAuthorization(overrides: Partial<Authorization> = {}): Authorization {
  return {
    from: FROM,
    to: MERCHANT,
    value: "6000",
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + 200),
    nonce: `0x${"11".repeat(32)}`,
    ...overrides,
  };
}

function makeV2Header(options: {
  auth?: Authorization;
  accepted?: Record<string, unknown>;
  resource?: Record<string, unknown> | null;
  omitResource?: boolean;
  spacing?: number;
} = {}): string {
  const face = makeFace();
  const payload: Record<string, unknown> = {
    x402Version: 2,
    accepted: options.accepted ?? face.v2Accept,
    payload: {
      signature: `0x${"cd".repeat(65)}`,
      authorization: options.auth ?? makeAuthorization(),
    },
  };
  if (!options.omitResource) {
    payload.resource = options.resource === undefined
      ? { url: RESOURCE, description: "Aegis briefing", mimeType: "application/json" }
      : options.resource;
  }
  return Buffer.from(JSON.stringify(payload, null, options.spacing)).toString("base64");
}

function makeV1Header(auth = makeAuthorization()): string {
  return base64({
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: { signature: `0x${"cd".repeat(65)}`, authorization: auth },
  });
}

function makePolygonHeader(): string {
  return base64({ x402Version: 1, scheme: "exact", network: "eip155:137", payload: {} });
}

function makeRequest(headers: Record<string, string> = {}, principal = PRINCIPAL): NextRequest {
  const url = new URL("http://localhost/api/d2a/briefing-jpyc");
  if (principal) url.searchParams.set("principal", principal);
  return new NextRequest(url, {
    method: "GET",
    headers: {
      origin: "https://aegis.dwebxr.xyz",
      "x-forwarded-for": "203.0.113.42",
      ...headers,
    },
  });
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

interface FetchHandlers {
  discovery?: FetchHandler;
  requirements?: FetchHandler;
  relayVerify?: FetchHandler;
  relaySettle?: FetchHandler;
  facilitatorVerify?: FetchHandler;
  facilitatorSettle?: FetchHandler;
}

function installFetchMock(handlers: FetchHandlers = {}): jest.Mock {
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/discovery")) {
      return (handlers.discovery ?? (() => jsonResponse(makeDiscovery())))(url, init);
    }
    if (url.includes("/api/x402/relay/requirements")) {
      return (handlers.requirements ?? (() => jsonResponse(makeFace())))(url, init);
    }
    if (url.endsWith("/api/x402/relay/verify")) {
      return (handlers.relayVerify ?? (() => jsonResponse({ isValid: true, payer: FROM })))(url, init);
    }
    if (url.endsWith("/api/x402/relay/settle")) {
      return (handlers.relaySettle ?? (() => jsonResponse({
        success: true,
        transaction: TRANSACTION,
        network: "base",
        payer: FROM.toLowerCase(),
        ignored: "not in receipt",
      })))(url, init);
    }
    if (url.endsWith("/api/facilitator/verify")) {
      return (handlers.facilitatorVerify ?? (() => jsonResponse({ isValid: true })))(url, init);
    }
    if (url.endsWith("/api/facilitator/settle")) {
      return (handlers.facilitatorSettle ?? (() => jsonResponse({ success: true, txHash: "0xlegacy" })))(url, init);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  global.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

async function loadRoute(briefing: unknown = sampleBriefing) {
  jest.resetModules();
  const provider = await import("@/lib/d2a/briefingProvider");
  (provider.getLatestBriefing as jest.Mock).mockResolvedValue(briefing);
  (provider.getGlobalBriefingSummaries as jest.Mock).mockResolvedValue(null);
  const rateLimit = await import("@/lib/api/rateLimit");
  rateLimit._resetRateLimits();
  const route = await import("@/app/api/d2a/briefing-jpyc/route");
  const usdc = await import("@/lib/d2a/openpayUsdc");
  usdc._resetUsdcState();
  return { ...route, usdc, provider };
}

function relayCalls(fetchMock: jest.Mock): unknown[][] {
  return fetchMock.mock.calls.filter(call => String(call[0]).includes("/api/x402/relay/"));
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
}

function mockAbortTimeouts(): void {
  jest.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), milliseconds);
    return controller.signal;
  });
}

function rejectOnAbort(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("timeout", "TimeoutError"));
    });
  });
}

const realFetch = global.fetch;
const originalEnv = { ...process.env };
let infoSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.OPENPAY_MERCHANT_ADDRESS = MERCHANT;
  process.env.OPENPAY_USDC_RAIL_ENABLED = "true";
  process.env.OPENPAY_RESOURCE_ID = RESOURCE_ID;
  // The rail refuses to advertise without KV (every state read fails closed).
  // The namespace itself is mocked above; only the presence check reads this.
  process.env.KV_REST_API_URL = "https://kv.example.test";
  process.env.KV_REST_API_TOKEN = "kv-token";
  delete process.env.OPENPAY_URL;
  delete process.env.OPENPAY_RESOURCE_URL;
  delete process.env.OPENPAY_USDC_ASSET;
  delete process.env.OPENPAY_USDC_MAX_AMOUNT;
  delete process.env.OPENPAY_JPYC_ASSET;
  delete process.env.X402_FREE_TIER_ENABLED;
  mockOpenpayStore.clear();
  mockOpenpaySetOptions.clear();
  mockKvControl.unavailable = false;
  mockKvControl.claim = "normal";
  mockKvControl.finalWrite = "normal";
  mockOpenpayPaymentKV.get.mockClear();
  mockOpenpayPaymentKV.set.mockClear();
  mockOpenpayPaymentKV.del.mockClear();
  mockRateLimitKV.incr.mockClear();
  mockRateLimitKV.ttl.mockClear();
  mockCaptureMessage.mockClear();
  mockCaptureException.mockClear();
  infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = realFetch;
  process.env = { ...originalEnv };
  jest.useRealTimers();
  infoSpy.mockRestore();
  warnSpy.mockRestore();
  jest.restoreAllMocks();
});

describe("OFF regression", () => {
  it("ignores PAYMENT-SIGNATURE and stays on the one-accept JPYC challenge", async () => {
    delete process.env.OPENPAY_USDC_RAIL_ENABLED;
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body.error).toBe("payment_required");
    expect(body.accepts).toHaveLength(1);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
    expect(relayCalls(fetchMock)).toHaveLength(0);
    expect(mockOpenpayPaymentKV.get).not.toHaveBeenCalled();
  });

  it("passes a Base X-PAYMENT to the legacy facilitator without relay or KV", async () => {
    delete process.env.OPENPAY_USDC_RAIL_ENABLED;
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "x-payment": makeV1Header() }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/facilitator/verify"))).toBe(true);
    expect(relayCalls(fetchMock)).toHaveLength(0);
    expect(mockOpenpayPaymentKV.get).not.toHaveBeenCalled();
  });

  it.each([
    [503, () => jsonResponse({ error: "down" }, 502)],
    [402, () => jsonResponse(makeDiscovery())],
  ])("keeps malformed X-PAYMENT legacy behavior (%i)", async (status, discovery) => {
    delete process.env.OPENPAY_USDC_RAIL_ENABLED;
    const fetchMock = installFetchMock({ discovery });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "x-payment": "not-json" }));
    expect(res.status).toBe(status);
    expect(relayCalls(fetchMock)).toHaveLength(0);
    expect(mockOpenpayPaymentKV.get).not.toHaveBeenCalled();
  });

  it("falls back to JPYC when the flag is on but resourceId is malformed", async () => {
    process.env.OPENPAY_RESOURCE_ID = "bad";
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(402);
    expect((await res.json()).accepts).toHaveLength(1);
    expect(relayCalls(fetchMock)).toHaveLength(0);
    expect(mockOpenpayPaymentKV.get).not.toHaveBeenCalled();
  });

  it("keeps the legacy gate's merchant check (non-empty only) when the flag is off", async () => {
    // The old route only required a non-empty merchant; the USDC rail's stricter
    // address-format check must not turn a working JPYC deployment into a 503.
    delete process.env.OPENPAY_USDC_RAIL_ENABLED;
    process.env.OPENPAY_MERCHANT_ADDRESS = "not-an-address";
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    // Discovery is consulted (legacy path); the catalog merchant simply fails
    // to match, which the legacy gate reports as the resource being unavailable.
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("OpenPay resource not available");
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/api/discovery"))).toBe(true);
    expect(relayCalls(fetchMock)).toHaveLength(0);
  });

  it.each([
    ["URL missing", () => { delete process.env.KV_REST_API_URL; }],
    ["token missing", () => { delete process.env.KV_REST_API_TOKEN; }],
    ["token blank", () => { process.env.KV_REST_API_TOKEN = "   "; }],
  ])("does not advertise USDC without KV (%s) — every payment would 503 before settle", async (_name, breakKv) => {
    breakKv();
    const fetchMock = installFetchMock();
    const { GET, usdc } = await loadRoute();
    expect(usdc.usdcRailConfig()).toEqual({ enabled: false, reason: "kv not configured" });
    const res = await GET(makeRequest());
    expect(res.status).toBe(402);
    expect((await res.json()).accepts).toHaveLength(1);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/relay/requirements"))).toBe(false);
  });

  it("disables only the USDC rail when the merchant is not an address", async () => {
    process.env.OPENPAY_MERCHANT_ADDRESS = "not-an-address";
    const fetchMock = installFetchMock();
    const { GET, usdc } = await loadRoute();
    expect(usdc.usdcRailConfig()).toEqual({ enabled: false, reason: "merchant address malformed" });
    await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/relay/requirements"))).toBe(false);
    expect(mockOpenpayPaymentKV.get).not.toHaveBeenCalled();
  });
});

describe("challenge and face validation", () => {
  it("combines JPYC and USDC and forwards the exact PAYMENT-REQUIRED string", async () => {
    const face = makeFace();
    const fetchMock = installFetchMock({ requirements: () => jsonResponse(face) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body.accepts).toHaveLength(2);
    expect(body.accepts[1].network).toBe("base");
    expect(res.headers.get("PAYMENT-REQUIRED")).toBe(face.paymentRequiredHeader);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
    expect(relayCalls(fetchMock)).toHaveLength(1);
  });

  it("serves a USDC-only challenge when discovery is unavailable", async () => {
    installFetchMock({ discovery: () => jsonResponse({}, 502) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(402);
    expect((await res.json()).accepts).toHaveLength(1);
    expect(res.headers.get("PAYMENT-REQUIRED")).not.toBeNull();
  });

  it("serves JPYC-only when requirements are unavailable", async () => {
    installFetchMock({ requirements: () => jsonResponse({}, 404) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(402);
    expect((await res.json()).accepts).toHaveLength(1);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
  });

  it("503s when both discovery and requirements are unavailable", async () => {
    installFetchMock({
      discovery: () => jsonResponse({}, 502),
      requirements: () => jsonResponse({}, 502),
    });
    const { GET } = await loadRoute();
    expect((await GET(makeRequest())).status).toBe(503);
  });

  const invalidFaces: Array<[string, (face: FaceRecord) => void]> = [
    ["resource id", face => { face.resourceId = "00000000-0000-0000-0000-000000000000"; }],
    ["v1 scheme", face => { face.v1Accepts.scheme = "transfer"; }],
    ["v1 network", face => { face.v1Accepts.network = "eip155:8453"; }],
    ["v1 asset", face => { face.v1Accepts.asset = ATTACKER; }],
    ["v1 payTo", face => { face.v1Accepts.payTo = ATTACKER; }],
    ["v1 resource", face => { face.v1Accepts.resource = "https://evil.example/pay"; }],
    ["v1 description", face => { face.v1Accepts.description = null; }],
    ["v1 mime type", face => { face.v1Accepts.mimeType = null; }],
    ["zero amount", face => { face.v1Accepts.maxAmountRequired = "0"; }],
    ["over-max amount", face => { face.v1Accepts.maxAmountRequired = "6001"; }],
    ["zero timeout", face => { face.v1Accepts.maxTimeoutSeconds = 0; }],
    ["over-max timeout", face => { face.v1Accepts.maxTimeoutSeconds = 3601; }],
    ["v2 scheme", face => { face.v2Accept.scheme = "transfer"; }],
    ["v2 network", face => { face.v2Accept.network = "base"; }],
    ["v2 asset", face => { face.v2Accept.asset = ATTACKER; }],
    ["v2 payTo", face => { face.v2Accept.payTo = ATTACKER; }],
    ["v2 amount", face => { face.v2Accept.amount = "5999"; }],
    ["v2 timeout", face => { face.v2Accept.maxTimeoutSeconds = 299; }],
    ["v2 extra", face => { face.v2Accept.extra = null; }],
    ["header accepts", face => {
      const changed = { ...face.v2Accept, extra: { name: "attacker" } };
      face.paymentRequiredHeader = requiredHeader(changed);
    }],
    ["oversized header", face => { face.paymentRequiredHeader = "A".repeat(16 * 1024 + 1); }],
    ["header alphabet", face => { face.paymentRequiredHeader = "%%%"; }],
    ["header version", face => {
      face.paymentRequiredHeader = base64({
        x402Version: 1,
        resource: { url: RESOURCE },
        accepts: [face.v2Accept],
      });
    }],
    ["header resource", face => {
      face.paymentRequiredHeader = base64({
        x402Version: 2,
        resource: { url: "https://evil.example/pay" },
        accepts: [face.v2Accept],
      });
    }],
    ["header empty accepts", face => {
      face.paymentRequiredHeader = base64({
        x402Version: 2,
        resource: { url: RESOURCE },
        accepts: [],
      });
    }],
  ];

  it.each(invalidFaces)("rejects a face with invalid %s", async (_name, mutate) => {
    const face = makeFace();
    mutate(face);
    installFetchMock({ requirements: () => jsonResponse(face) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(402);
    expect((await res.json()).accepts).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an attacker payTo even when v1, v2 and header agree", async () => {
    const face = makeFace();
    face.v1Accepts.payTo = ATTACKER;
    face.v2Accept.payTo = ATTACKER;
    face.paymentRequiredHeader = requiredHeader(face.v2Accept);
    installFetchMock({ requirements: () => jsonResponse(face) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    expect((await res.json()).accepts).toHaveLength(1);
  });

  it.each([
    ["404", () => jsonResponse({}, 404)],
    ["non-JSON", () => new Response("not json", { status: 200 })],
    ["truncated", () => new Response("x".repeat(512 * 1024 + 1), { status: 200 })],
  ])("negative-caches %s requirements failures for 30 seconds", async (_name, requirements) => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = installFetchMock({ requirements });
    const { GET } = await loadRoute();
    await GET(makeRequest());
    await GET(makeRequest());
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes("/requirements"))).toHaveLength(1);
    now += 31_000;
    await GET(makeRequest());
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes("/requirements"))).toHaveLength(2);
  });

  it("treats a pathologically nested requirements response as no face, not a 500", async () => {
    const face = makeFace();
    let nested: Record<string, unknown> = { name: "USD Coin", version: "2" };
    for (let i = 0; i < 200; i++) nested = { deeper: nested };
    face.v2Accept = { ...face.v2Accept, extra: nested };
    face.paymentRequiredHeader = requiredHeader(face.v2Accept);
    installFetchMock({ requirements: () => jsonResponse(face) });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(402);
    expect((await res.json()).accepts).toHaveLength(1);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("validation threw"));
  });

  it("caches a valid face for five minutes", async () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    await GET(makeRequest());
    await GET(makeRequest());
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes("/requirements"))).toHaveLength(1);
    now += 301_000;
    await GET(makeRequest());
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes("/requirements"))).toHaveLength(2);
  });

  it("single-flights concurrent face requests", async () => {
    let resolveFace!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveFace = resolve; });
    const fetchMock = installFetchMock({ requirements: () => pending });
    const { usdc } = await loadRoute();
    const first = usdc.fetchUsdcFace();
    const second = usdc.fetchUsdcFace();
    resolveFace(jsonResponse(makeFace()));
    expect(await first).not.toBeNull();
    expect(await second).not.toBeNull();
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes("/requirements"))).toHaveLength(1);
  });

  it("aborts requirements at five seconds and returns the JPYC challenge", async () => {
    jest.useFakeTimers();
    mockAbortTimeouts();
    const fetchMock = installFetchMock({ requirements: rejectOnAbort });
    const { GET } = await loadRoute();
    const pending = GET(makeRequest());
    await jest.advanceTimersByTimeAsync(5_000);
    const res = await pending;
    expect(res.status).toBe(402);
    expect((await res.json()).accepts).toHaveLength(1);
    const call = fetchMock.mock.calls.find(item => String(item[0]).includes("/requirements"));
    expect((call[1] as RequestInit).signal?.aborted).toBe(true);
  });
});

describe("rail selection and requirements matching", () => {
  it("rejects ambiguous headers before fetch or KV", async () => {
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({
      "payment-signature": makeV2Header(),
      "x-payment": makeV1Header(),
    }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("ambiguous_payment");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockOpenpayPaymentKV.get).not.toHaveBeenCalled();
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
  });

  it.each([
    ["v2", "payment-signature", makeV2Header(), "paymentSignatureHeader"],
    ["v1", "x-payment", makeV1Header(), "paymentHeader"],
  ])("relays the raw %s header under %s", async (_rail, headerName, header, bodyKey) => {
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({ [headerName]: header }))).status).toBe(200);
    const verifyCall = fetchMock.mock.calls.find(call => String(call[0]).endsWith("/relay/verify"));
    expect(bodyOf(verifyCall)).toEqual({ resourceId: RESOURCE_ID, [bodyKey]: header });
  });

  it("keeps Polygon X-PAYMENT on the facilitator path", async () => {
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({ "x-payment": makePolygonHeader() }))).status).toBe(200);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/facilitator/verify"))).toBe(true);
    expect(relayCalls(fetchMock)).toHaveLength(0);
    expect(mockOpenpayPaymentKV.get).not.toHaveBeenCalled();
  });

  it("keeps malformed X-PAYMENT on the legacy 402 path", async () => {
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "x-payment": "%%%" }));
    expect(res.status).toBe(402);
    expect(relayCalls(fetchMock)).toHaveLength(0);
  });

  const mismatches: Array<[string, () => string]> = [
    ["accepted payTo", () => makeV2Header({ accepted: { ...makeFace().v2Accept, payTo: ATTACKER } })],
    ["accepted amount", () => makeV2Header({ accepted: { ...makeFace().v2Accept, amount: "1" } })],
    ["accepted asset", () => makeV2Header({ accepted: { ...makeFace().v2Accept, asset: ATTACKER } })],
    ["accepted network", () => makeV2Header({ accepted: { ...makeFace().v2Accept, network: "base" } })],
    ["authorization to", () => makeV2Header({ auth: makeAuthorization({ to: ATTACKER }) })],
    ["authorization value", () => makeV2Header({ auth: makeAuthorization({ value: "1" }) })],
    ["expired validBefore", () => makeV2Header({ auth: makeAuthorization({ validBefore: "1" }) })],
    ["long validBefore", () => makeV2Header({
      auth: makeAuthorization({ validBefore: String(Math.floor(Date.now() / 1000) + 361) }),
    })],
    ["resource URL", () => makeV2Header({ resource: { url: "https://evil.example/pay" } })],
  ];

  it.each(mismatches)("402s on mismatched %s before lock/relay", async (_name, header) => {
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "payment-signature": header() }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("payment_requirements_mismatch");
    expect(res.headers.get("PAYMENT-REQUIRED")).not.toBeNull();
    expect(mockOpenpayPaymentKV.set).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/relay/verify"))).toBe(false);
  });

  it("allows a v2 payload that omits resource", async () => {
    installFetchMock();
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({
      "payment-signature": makeV2Header({ omitResource: true }),
    }))).status).toBe(200);
  });

  it.each(["%%%", base64([1, 2, 3]), "A".repeat(16 * 1024 + 1)])(
    "rejects an invalid v2 header without PAYMENT-REQUIRED",
    async (header) => {
      installFetchMock();
      const { GET } = await loadRoute();
      const res = await GET(makeRequest({ "payment-signature": header }));
      expect(res.status).toBe(402);
      expect((await res.json()).error).toBe("invalid_payment_payload");
      expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
    },
  );
});

describe("durable identity, state, lock, and claim", () => {
  it("uses one identity for equivalent v2 and v1 authorizations", async () => {
    const auth = makeAuthorization();
    installFetchMock();
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({ "payment-signature": makeV2Header({ auth, spacing: 2 }) }))).status).toBe(200);
    const replay = await GET(makeRequest({ "x-payment": makeV1Header(auth) }));
    expect(replay.status).toBe(409);
    expect((await replay.json()).reason).toBe("payment_already_used");
  });

  it("ignores JSON whitespace, key order, and omitted base64 padding in identity", async () => {
    const auth = makeAuthorization();
    const firstHeader = makeV2Header({ auth, spacing: 2 }).replace(/=+$/, "");
    installFetchMock();
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({ "payment-signature": firstHeader }))).status).toBe(200);
    const reordered = base64({
      payload: { authorization: {
        nonce: auth.nonce,
        validBefore: auth.validBefore,
        validAfter: auth.validAfter,
        value: auth.value,
        to: auth.to,
        from: auth.from,
      }, signature: "0xignored" },
      accepted: makeFace().v2Accept,
      x402Version: 2,
    });
    expect((await GET(makeRequest({ "payment-signature": reordered }))).status).toBe(409);
  });

  it("uses a distinct identity for a different nonce", async () => {
    installFetchMock();
    const { GET } = await loadRoute();
    expect((await GET(makeRequest({ "payment-signature": makeV2Header() }))).status).toBe(200);
    const second = makeAuthorization({ nonce: `0x${"22".repeat(32)}` });
    expect((await GET(makeRequest({ "payment-signature": makeV2Header({ auth: second }) }))).status).toBe(200);
  });

  async function identityFor(auth = makeAuthorization()): Promise<string> {
    const usdc = await import("@/lib/d2a/openpayUsdc");
    return usdc.paymentIdentity(auth);
  }

  it.each([
    ["settled", { status: "settled", at: Date.now() }, 409, null],
    ["active pending", { status: "pending", at: Date.now() }, 503, "30"],
    ["orphan pending", { status: "pending", at: Date.now() - 151_000 }, 503, null],
    ["unknown", { status: "unknown", at: Date.now() }, 503, null],
  ])("fails closed for %s state", async (_name, state, status, retryAfter) => {
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    mockOpenpayStore.set(`${await identityFor()}:state`, state);
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(status);
    expect(res.headers.get("Retry-After")).toBe(retryAfter);
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/relay/settle"))).toBe(false);
  });

  it("fails closed when KV is unavailable or state is malformed", async () => {
    installFetchMock();
    const { GET } = await loadRoute();
    mockKvControl.unavailable = true;
    let res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("10");

    mockKvControl.unavailable = false;
    mockOpenpayStore.set(`${await identityFor()}:state`, { status: "bogus", at: "bad" });
    res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(503);
  });

  it("checks settled state before revised face requirements", async () => {
    const auth = makeAuthorization();
    const changedFace = makeFace();
    changedFace.v1Accepts.maxAmountRequired = "5000";
    changedFace.v2Accept.amount = "5000";
    changedFace.paymentRequiredHeader = requiredHeader(changedFace.v2Accept);
    installFetchMock({ requirements: () => jsonResponse(changedFace) });
    const { GET, usdc } = await loadRoute();
    mockOpenpayStore.set(`${usdc.paymentIdentity(auth)}:state`, { status: "settled", at: Date.now() });
    const res = await GET(makeRequest({ "payment-signature": makeV2Header({ auth }) }));
    expect(res.status).toBe(409);
  });

  it("continues through relay verify from a rejected state", async () => {
    const fetchMock = installFetchMock({
      relayVerify: () => jsonResponse({ isValid: false, invalidReason: "invalid_signature" }),
    });
    const { GET, usdc } = await loadRoute();
    mockOpenpayStore.set(`${usdc.paymentIdentity(makeAuthorization())}:state`, {
      status: "rejected",
      at: Date.now(),
      reason: "invalid_signature",
    });
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(402);
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/relay/verify"))).toBe(true);
  });

  it("settles a rejected authorization on retry instead of reading its record as a foreign claim", async () => {
    // rejected = no funds moved, so the buyer may retry the same authorization
    // (e.g. after topping up). The stale record must not make the SET NX claim
    // look like another process settling.
    const fetchMock = installFetchMock({});
    const { GET, usdc } = await loadRoute();
    const identity = usdc.paymentIdentity(makeAuthorization());
    mockOpenpayStore.set(`${identity}:state`, {
      status: "rejected",
      at: Date.now(),
      reason: "insufficient_funds",
    });
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith("/relay/settle"))).toHaveLength(1);
    expect(mockOpenpayStore.get(`${identity}:state`)).toEqual(
      expect.objectContaining({ status: "settled", transaction: TRANSACTION }),
    );
  });

  it("returns payment_in_progress when the lock is busy", async () => {
    installFetchMock();
    const { GET, usdc } = await loadRoute();
    mockOpenpayStore.set(`${usdc.paymentIdentity(makeAuthorization())}:lock`, { at: Date.now() });
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("10");
  });

  it("settles at most once for two concurrent copies", async () => {
    let releaseVerify!: () => void;
    const verifyGate = new Promise<void>(resolve => { releaseVerify = resolve; });
    const fetchMock = installFetchMock({
      relayVerify: async () => {
        await verifyGate;
        return jsonResponse({ isValid: true });
      },
    });
    const { GET } = await loadRoute();
    const first = GET(makeRequest({ "payment-signature": makeV2Header() }));
    await Promise.resolve();
    const second = GET(makeRequest({ "payment-signature": makeV2Header() }));
    releaseVerify();
    const statuses = [(await first).status, (await second).status].sort();
    expect(statuses).toEqual([200, 503]);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith("/relay/settle"))).toHaveLength(1);
  });

  it.each([
    ["exists", "exists", null],
    ["unavailable", "unavailable", "10"],
  ] as const)("does not settle when claim is %s", async (_name, claim, retry) => {
    mockKvControl.claim = claim;
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe(retry);
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/relay/settle"))).toBe(false);
    expect(mockOpenpayPaymentKV.del).toHaveBeenCalled();
  });

  it("aborts relay verify after ten seconds", async () => {
    jest.useFakeTimers();
    mockAbortTimeouts();
    const fetchMock = installFetchMock({ relayVerify: rejectOnAbort });
    const { GET } = await loadRoute();
    const pending = GET(makeRequest({ "payment-signature": makeV2Header() }));
    await jest.advanceTimersByTimeAsync(10_000);
    const res = await pending;
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("verification_unavailable");
    const call = fetchMock.mock.calls.find(item => String(item[0]).endsWith("/relay/verify"));
    expect((call[1] as RequestInit).signal?.aborted).toBe(true);
    expect(mockOpenpayPaymentKV.del).toHaveBeenCalled();
  });
});

describe("verify, content, deadline, and settlement", () => {
  it("returns an allowlisted verify rejection as 402 and releases the lock", async () => {
    installFetchMock({
      relayVerify: () => jsonResponse({ isValid: false, invalidReason: "invalid_signature" }),
    });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("invalid_signature");
    expect(res.headers.get("PAYMENT-REQUIRED")).not.toBeNull();
    expect(mockOpenpayPaymentKV.del).toHaveBeenCalled();
  });

  it.each([
    ["unknown reason", () => jsonResponse({ isValid: false, invalidReason: "invalid_exact_evm_nonce_already_used" })],
    ["non-2xx success", () => jsonResponse({ isValid: true }, 502)],
    ["non-JSON", () => new Response("bad", { status: 200 })],
  ])("fails verify closed for %s", async (_name, relayVerify) => {
    installFetchMock({ relayVerify });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("verification_unavailable");
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
    expect(res.headers.get("Retry-After")).toBe("10");
    expect(mockOpenpayPaymentKV.del).toHaveBeenCalled();
  });

  it.each([
    ["404 content", null, PRINCIPAL, 404],
    ["400 content", sampleBriefing, "not-a-principal", 400],
  ])("does not settle after %s", async (_name, briefing, principal, status) => {
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute(briefing);
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }, principal));
    expect(res.status).toBe(status);
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/relay/settle"))).toBe(false);
    expect(mockOpenpayPaymentKV.del).toHaveBeenCalled();
    expect([...mockOpenpayStore.keys()].some(key => key.endsWith(":state"))).toBe(false);
  });

  it("does not claim or settle after the 40-second deadline", async () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = installFetchMock();
    const { GET, provider } = await loadRoute();
    (provider.getLatestBriefing as jest.Mock).mockImplementation(async () => {
      now += 41_000;
      return sampleBriefing;
    });
    const header = makeV2Header({
      auth: makeAuthorization({ validBefore: String(Math.floor(now / 1000) + 200) }),
    });
    const res = await GET(makeRequest({ "payment-signature": header }));
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("settlement_deadline_exceeded");
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/relay/settle"))).toBe(false);
    expect(mockOpenpayPaymentKV.set.mock.calls.filter(call => String(call[0]).endsWith(":state"))).toHaveLength(0);
  });

  it("re-checks the deadline after a slow claim: no settle, record becomes rejected", async () => {
    // The claim is a KV round-trip with no timeout of its own. If it is the
    // step that eats the budget, settle must still not start.
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = installFetchMock();
    const { GET, usdc } = await loadRoute();
    const originalSet = mockOpenpayPaymentKV.set.getMockImplementation()!;
    mockOpenpayPaymentKV.set.mockImplementation(async (key, value, options) => {
      if (key.endsWith(":state") && options?.nx) now += 41_000;
      return originalSet(key, value, options);
    });
    const auth = makeAuthorization({ validBefore: String(Math.floor(now / 1000) + 200) });
    const res = await GET(makeRequest({ "payment-signature": makeV2Header({ auth }) }));
    mockOpenpayPaymentKV.set.mockImplementation(originalSet);
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("settlement_deadline_exceeded");
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/relay/settle"))).toBe(false);
    expect(mockOpenpayStore.get(`${usdc.paymentIdentity(auth)}:state`)).toEqual(
      expect.objectContaining({ status: "rejected", reason: "settlement_deadline_exceeded" }),
    );
    expect(mockOpenpayStore.has(`${usdc.paymentIdentity(auth)}:lock`)).toBe(false);
  });

  it.each([
    ["v2", "payment-signature", makeV2Header(), true],
    ["v1", "x-payment", makeV1Header(), false],
  ])("settles %s once, stores TTL state, and emits canonical receipt", async (
    _rail,
    headerName,
    header,
    hasV2Header,
  ) => {
    const fetchMock = installFetchMock();
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ [headerName]: header }));
    expect(res.status).toBe(200);
    const receiptHeader = res.headers.get("X-PAYMENT-RESPONSE");
    expect(receiptHeader).not.toBeNull();
    expect(res.headers.get("PAYMENT-RESPONSE") !== null).toBe(hasV2Header);
    const receipt = JSON.parse(Buffer.from(receiptHeader!, "base64").toString("utf8"));
    expect(receipt).toEqual({
      success: true,
      transaction: TRANSACTION,
      network: "eip155:8453",
      payer: FROM.toLowerCase(),
    });
    expect(receiptHeader!.length).toBeLessThan(4 * 1024);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith("/relay/settle"))).toHaveLength(1);
    const stateKey = [...mockOpenpayStore.keys()].find(key => key.endsWith(":state"));
    expect(mockOpenpayStore.get(stateKey!)).toEqual(expect.objectContaining({
      status: "settled",
      transaction: TRANSACTION,
    }));
    expect(mockOpenpaySetOptions.get(stateKey!)).toEqual(expect.objectContaining({ ex: 90 * 24 * 3600 }));
  });

  it("records an allowlisted settle rejection and returns 402", async () => {
    installFetchMock({
      relaySettle: () => jsonResponse({ success: false, errorReason: "insufficient_funds" }),
    });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("insufficient_funds");
    expect([...mockOpenpayStore.values()]).toContainEqual(expect.objectContaining({ status: "rejected" }));
    expect(mockCaptureMessage).not.toHaveBeenCalledWith(
      "[openpay-usdc] settlement unknown",
      expect.anything(),
    );
  });

  it("accepts a checksum-cased payer that differs from the authorization's casing", async () => {
    // Authorization signed with an all-lowercase `from`; the relay reports the
    // payer in EIP-55 checksum casing. Same address, different bytes.
    const lowerFrom = FROM.toLowerCase();
    expect(lowerFrom).not.toBe(FROM);
    installFetchMock({
      relaySettle: () => jsonResponse({ success: true, transaction: TRANSACTION, network: "eip155:8453", payer: FROM }),
    });
    const { GET } = await loadRoute();
    const auth = makeAuthorization({ from: lowerFrom });
    const res = await GET(makeRequest({ "payment-signature": makeV2Header({ auth }) }));
    expect(res.status).toBe(200);
    const receipt = JSON.parse(Buffer.from(res.headers.get("PAYMENT-RESPONSE")!, "base64").toString("utf8"));
    expect(receipt).toEqual({ success: true, transaction: TRANSACTION, network: "eip155:8453", payer: FROM });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  const unknownSettles: Array<[string, FetchHandler]> = [
    ["nonce already used", () => jsonResponse({ success: false, errorReason: "nonce_already_used" })],
    // An allowlisted reason next to a transaction hash contradicts itself.
    ["allowlisted reason with broadcast evidence", () => jsonResponse({ success: false, errorReason: "insufficient_funds", transaction: TRANSACTION })],
    ["allowlisted reason with txHash", () => jsonResponse({ success: false, errorReason: "invalid_signature", txHash: TRANSACTION })],
    ["allowlisted reason with transactionHash", () => jsonResponse({ success: false, errorReason: "insufficient_funds", transactionHash: TRANSACTION })],
    ["allowlisted reason with hash", () => jsonResponse({ success: false, errorReason: "insufficient_funds", hash: TRANSACTION })],
    ["allowlisted reason with receipt", () => jsonResponse({ success: false, errorReason: "insufficient_funds", receipt: { status: "0x1" } })],
    ["duplicate", () => jsonResponse({ success: false, errorReason: "duplicate_settlement" })],
    ["empty reason", () => jsonResponse({ success: false, errorReason: "" })],
    ["non-2xx", () => jsonResponse({ success: true, transaction: TRANSACTION, network: "base", payer: FROM }, 502)],
    ["bad transaction", () => jsonResponse({ success: true, transaction: "0xbad", network: "base", payer: FROM })],
    ["wrong payer", () => jsonResponse({ success: true, transaction: TRANSACTION, network: "base", payer: OTHER_FROM })],
    ["wrong network", () => jsonResponse({ success: true, transaction: TRANSACTION, network: "eip155:1", payer: FROM })],
  ];

  it.each(unknownSettles)("records %s settle as unknown", async (_name, relaySettle) => {
    const fetchMock = installFetchMock({ relaySettle });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest({ "payment-signature": makeV2Header() }));
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("settlement_unknown");
    expect(res.headers.get("Retry-After")).toBeNull();
    expect([...mockOpenpayStore.values()]).toContainEqual(expect.objectContaining({ status: "unknown" }));
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith("/relay/settle"))).toHaveLength(1);
  });

  it("aborts relay settle after fifteen seconds and records unknown", async () => {
    jest.useFakeTimers();
    mockAbortTimeouts();
    const fetchMock = installFetchMock({ relaySettle: rejectOnAbort });
    const { GET } = await loadRoute();
    const pending = GET(makeRequest({ "payment-signature": makeV2Header() }));
    await jest.advanceTimersByTimeAsync(15_000);
    const res = await pending;
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("settlement_unknown");
    const call = fetchMock.mock.calls.find(item => String(item[0]).endsWith("/relay/settle"));
    expect((call[1] as RequestInit).signal?.aborted).toBe(true);
    expect([...mockOpenpayStore.values()]).toContainEqual(expect.objectContaining({ status: "unknown" }));
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
  });

  it.each(["null", "throw", "hang"] as const)("delivers content when final state write returns %s", async (mode) => {
    mockKvControl.finalWrite = mode;
    if (mode === "hang") jest.useFakeTimers();
    const fetchMock = installFetchMock();
    const { GET, usdc } = await loadRoute();
    const header = makeV2Header();
    const pendingFirst = GET(makeRequest({ "payment-signature": header }));
    // A KV that never answers must not hold the paid content past the 3s bound.
    if (mode === "hang") await jest.advanceTimersByTimeAsync(usdc.STATE_WRITE_TIMEOUT_MS + 1);
    const first = await pendingFirst;
    expect(first.status).toBe(200);
    if (mode === "hang") {
      jest.useRealTimers();
      mockKvControl.finalWrite = "normal";
    }
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      "[openpay-usdc] state write failed",
      expect.objectContaining({ level: "error" }),
    );
    // The durable `pending` claim alone must fence a retry — drop the 150s lock
    // so the assertion does not pass merely because the lock is still held.
    const identity = usdc.paymentIdentity(makeAuthorization());
    mockOpenpayStore.delete(`${identity}:lock`);
    expect(mockOpenpayStore.get(`${identity}:state`)).toEqual(expect.objectContaining({ status: "pending" }));
    const second = await GET(makeRequest({ "payment-signature": header }));
    expect(second.status).toBe(503);
    expect((await second.json()).reason).toBe("payment_in_progress");
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith("/relay/settle"))).toHaveLength(1);
  });

  it("wraps new error responses with no-store and CORS", async () => {
    installFetchMock();
    const { GET } = await loadRoute();
    const responses = [
      await GET(makeRequest({ "payment-signature": "%%%" })),
      await GET(makeRequest({
        "payment-signature": makeV2Header(),
        "x-payment": makeV1Header(),
      })),
    ];
    for (const res of responses) {
      expect(res.headers.get("Cache-Control")).toBe("no-store, private");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
    }
  });
});
