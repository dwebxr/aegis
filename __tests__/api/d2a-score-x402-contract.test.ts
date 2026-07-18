import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FacilitatorClient } from "@x402/core/server";
import {
  decodePaymentSignatureHeader,
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402 } from "@x402/next";
import { NextRequest, NextResponse } from "next/server";
import { withCors } from "@/lib/d2a/cors";
import {
  canonicalPaymentIdentity as realCanonicalPaymentIdentity,
} from "@/lib/d2a/settlementJournal";
import { strictFacilitatorClient } from "@/lib/d2a/strictFacilitatorClient";

const NETWORK = "eip155:84532" as const;
const RECEIVER = "0x0000000000000000000000000000000000000001";

class FakeFacilitator implements FacilitatorClient {
  verify = jest.fn<Promise<VerifyResponse>, [PaymentPayload, PaymentRequirements]>();
  settle = jest.fn<Promise<SettleResponse>, [PaymentPayload, PaymentRequirements]>();
  getSupported = jest.fn<Promise<SupportedResponse>, []>();

  constructor() {
    this.verify.mockResolvedValue({ isValid: true, payer: "0xpayer" });
    this.settle.mockResolvedValue({
      success: true,
      transaction: "0xtx",
      network: NETWORK,
      payer: "0xpayer",
    });
    this.getSupported.mockResolvedValue({
      kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }],
      extensions: [],
      signers: { [NETWORK]: ["0xfacilitator"] },
    });
  }
}

function request(
  payment?: string,
  articleUrl = "https://example.com",
  paymentHeader = "PAYMENT-SIGNATURE",
): NextRequest {
  const url = new URL("http://localhost/api/d2a/score");
  url.searchParams.set("url", articleUrl);
  return new NextRequest(url, {
    method: "GET",
    headers: {
      origin: "https://aegis.dwebxr.xyz",
      ...(payment ? { [paymentHeader]: payment } : {}),
    },
  });
}

function finalize(response: NextResponse, req: NextRequest): NextResponse {
  response.headers.set("Cache-Control", "no-store, private");
  return withCors(response, req.headers.get("origin"));
}

function harness(
  facilitator: FakeFacilitator,
  handler: (request: NextRequest) => Promise<NextResponse>,
) {
  const server = new x402ResourceServer(strictFacilitatorClient(facilitator))
    .register(NETWORK, new ExactEvmScheme());
  const canceled = jest.fn();
  server.onVerifiedPaymentCanceled(async (context) => {
    canceled(context.reason, context.responseStatus);
  });
  const paid = withX402(handler, {
    accepts: {
      scheme: "exact",
      price: "$0.02",
      network: NETWORK,
      payTo: RECEIVER,
      maxTimeoutSeconds: 300,
    },
    description: "Score a URL's content quality (V/C/L) with AI",
  }, server);

  return {
    canceled,
    async endpoint(req: NextRequest, enabled = true): Promise<NextResponse> {
      if (!enabled) {
        return finalize(
          NextResponse.json(
            { error: "URL scoring is disabled", reason: "disabled" },
            { status: 503 },
          ),
          req,
        );
      }
      return finalize(await paid(req), req);
    },
  };
}

async function paymentFor(endpoint: (req: NextRequest) => Promise<NextResponse>): Promise<string> {
  const unpaid = await endpoint(request());
  const encodedRequired = unpaid.headers.get("PAYMENT-REQUIRED");
  expect(encodedRequired).toBeTruthy();
  const required = decodePaymentRequiredHeader(encodedRequired!);
  const payload: PaymentPayload = {
    x402Version: 2,
    resource: required.resource,
    accepted: required.accepts[0],
    payload: {
      authorization: {
        from: "0x0000000000000000000000000000000000000002",
        to: RECEIVER,
        value: required.accepts[0].amount,
        validAfter: "0",
        validBefore: "1750000000",
        nonce: `0x${"ab".repeat(32)}`,
      },
      signature: "0xfake",
    },
  };
  return encodePaymentSignatureHeader(payload);
}

function equivalentPaymentEncodings(payment: string): [string, string] {
  const decoded = decodePaymentSignatureHeader(payment);
  const authorization = decoded.payload.authorization as Record<string, unknown>;
  const reordered = {
    payload: {
      signature: decoded.payload.signature,
      authorization: {
        nonce: authorization.nonce,
        validBefore: authorization.validBefore,
        validAfter: authorization.validAfter,
        value: authorization.value,
        to: authorization.to,
        from: authorization.from,
      },
    },
    accepted: decoded.accepted,
    resource: decoded.resource,
    x402Version: decoded.x402Version,
  };

  let paddedJson = JSON.stringify(decoded);
  while (!Buffer.from(paddedJson, "utf8").toString("base64").endsWith("=")) paddedJson += " ";
  let unpaddedJson = JSON.stringify(reordered, null, 2);
  while (Buffer.byteLength(unpaddedJson, "utf8") % 3 !== 0) unpaddedJson += " ";
  const padded = Buffer.from(paddedJson, "utf8").toString("base64");
  const unpadded = Buffer.from(unpaddedJson, "utf8").toString("base64");
  expect(padded).toMatch(/=$/);
  expect(unpadded).not.toMatch(/=$/);
  return [padded, unpadded];
}

describe("/api/d2a/score x402 v2 contract", () => {
  it("(a) returns 402 plus PAYMENT-REQUIRED when payment is absent", async () => {
    const fake = new FakeFacilitator();
    const handler = jest.fn(async () => NextResponse.json({ ok: true }));
    const { endpoint } = harness(fake, handler);

    const response = await endpoint(request());
    expect(response.status).toBe(402);
    expect(response.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
    expect(handler).not.toHaveBeenCalled();
  });

  it("(b) verifies, invokes a 200 handler, settles, and returns PAYMENT-RESPONSE", async () => {
    const fake = new FakeFacilitator();
    const handler = jest.fn(async () => NextResponse.json({ score: 10 }));
    const { endpoint } = harness(fake, handler);
    const payment = await paymentFor(endpoint);
    fake.verify.mockClear();
    fake.settle.mockClear();

    const response = await endpoint(request(payment));
    expect(response.status).toBe(200);
    expect(fake.verify).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fake.settle).toHaveBeenCalledTimes(1);
    expect(response.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
  });

  it.each([
    { isValid: false },
    {},
    null,
    { isValid: "true" },
  ])("(c) rejects every non-boolean-true verify result: %p", async (result) => {
    const fake = new FakeFacilitator();
    fake.verify.mockResolvedValue(result as unknown as VerifyResponse);
    const handler = jest.fn(async () => NextResponse.json({ ok: true }));
    const { endpoint } = harness(fake, handler);
    const payment = await paymentFor(endpoint);
    fake.verify.mockClear();
    fake.settle.mockClear();

    const response = await endpoint(request(payment));
    expect(response.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
    expect(fake.settle).not.toHaveBeenCalled();
  });

  it.each([400, 429, 502, 503])(
    "(d) does not settle a handler response with status %s",
    async (status) => {
      const fake = new FakeFacilitator();
      const handler = jest.fn(async () => NextResponse.json({ error: "failed" }, { status }));
      const { endpoint, canceled } = harness(fake, handler);
      const payment = await paymentFor(endpoint);
      fake.settle.mockClear();

      const response = await endpoint(request(payment));
      expect(response.status).toBe(status);
      expect(fake.settle).not.toHaveBeenCalled();
      expect(canceled).toHaveBeenCalledWith("handler_failed", status);
    },
  );

  it("(e) cancels verified work when the handler throws", async () => {
    const fake = new FakeFacilitator();
    const handler = jest.fn(async () => { throw new Error("handler exploded"); });
    const { endpoint, canceled } = harness(fake, handler);
    const payment = await paymentFor(endpoint);
    fake.settle.mockClear();

    await expect(endpoint(request(payment))).rejects.toThrow("handler exploded");
    expect(fake.settle).not.toHaveBeenCalled();
    expect(canceled).toHaveBeenCalledWith("handler_threw", undefined);
  });

  it("(f) replaces a successful handler response with 402 when settle reports failure", async () => {
    const fake = new FakeFacilitator();
    fake.settle.mockResolvedValue({
      success: false,
      transaction: "",
      network: NETWORK,
      errorReason: "settlement failed",
    });
    const { endpoint } = harness(fake, async () => NextResponse.json({ ok: true }));
    const payment = await paymentFor(endpoint);

    const response = await endpoint(request(payment));
    expect(response.status).toBe(402);
    expect(response.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
  });

  it("(g) returns disabled before verify/settle even with a syntactically valid payment", async () => {
    const requirementFake = new FakeFacilitator();
    const requirementHarness = harness(
      requirementFake,
      async () => NextResponse.json({ ok: true }),
    );
    const payment = await paymentFor(requirementHarness.endpoint);

    const routeFake = new FakeFacilitator();
    const routeServer = new x402ResourceServer(strictFacilitatorClient(routeFake))
      .register(NETWORK, new ExactEvmScheme());
    const previousEnabled = process.env.D2A_SCORE_ENABLED;
    const previousFree = process.env.D2A_SCORE_FREE_ENABLED;
    process.env.D2A_SCORE_ENABLED = "false";
    delete process.env.D2A_SCORE_FREE_ENABLED;
    jest.resetModules();
    jest.doMock("@/lib/d2a/x402Server", () => ({
      X402_NETWORK: NETWORK,
      X402_RECEIVER: RECEIVER,
      X402_SCORE_PRICE: "$0.02",
      resourceServer: routeServer,
    }));
    try {
      const actualRoute = require("@/app/api/d2a/score/route") as
        typeof import("@/app/api/d2a/score/route");
      const response = await actualRoute.GET(request(payment));
      expect(response.status).toBe(503);
      expect(routeFake.getSupported).not.toHaveBeenCalled();
      expect(routeFake.verify).not.toHaveBeenCalled();
      expect(routeFake.settle).not.toHaveBeenCalled();
    } finally {
      if (previousEnabled === undefined) delete process.env.D2A_SCORE_ENABLED;
      else process.env.D2A_SCORE_ENABLED = previousEnabled;
      if (previousFree === undefined) delete process.env.D2A_SCORE_FREE_ENABLED;
      else process.env.D2A_SCORE_FREE_ENABLED = previousFree;
      jest.dontMock("@/lib/d2a/x402Server");
      jest.resetModules();
    }
  });

  it("returns payments_disabled before verify/settle on all shared payment routes", async () => {
    const requirementFake = new FakeFacilitator();
    const requirementHarness = harness(
      requirementFake,
      async () => NextResponse.json({ ok: true }),
    );
    const payment = await paymentFor(requirementHarness.endpoint);

    const routeFake = new FakeFacilitator();
    const routeServer = new x402ResourceServer(strictFacilitatorClient(routeFake))
      .register(NETWORK, new ExactEvmScheme());
    const previousDisabled = process.env.D2A_PAYMENTS_DISABLED;
    const previousEnabled = process.env.D2A_SCORE_ENABLED;
    process.env.D2A_PAYMENTS_DISABLED = "true";
    process.env.D2A_SCORE_ENABLED = "true";
    jest.resetModules();
    jest.doMock("@/lib/d2a/x402Server", () => ({
      X402_NETWORK: NETWORK,
      X402_PRICE: "$0.01",
      X402_RECEIVER: RECEIVER,
      X402_SCORE_PRICE: "$0.02",
      resourceServer: routeServer,
    }));
    try {
      const scoreRoute = require("@/app/api/d2a/score/route") as
        typeof import("@/app/api/d2a/score/route");
      const briefingRoute = require("@/app/api/d2a/briefing/route") as
        typeof import("@/app/api/d2a/briefing/route");
      const changesRoute = require("@/app/api/d2a/briefing/changes/route") as
        typeof import("@/app/api/d2a/briefing/changes/route");
      const paidHeaders = { "PAYMENT-SIGNATURE": payment };
      const responses = await Promise.all([
        scoreRoute.GET(request(payment)),
        briefingRoute.GET(new NextRequest("http://localhost/api/d2a/briefing", {
          headers: paidHeaders,
        })),
        changesRoute.GET(new NextRequest(
          "http://localhost/api/d2a/briefing/changes?since=2026-01-01T00:00:00Z",
          { headers: paidHeaders },
        )),
      ]);

      expect(responses.map((response) => response.status)).toEqual([503, 503, 503]);
      await Promise.all(responses.map(async (response) => {
        expect((await response.json()).reason).toBe("payments_disabled");
      }));
      expect(routeFake.getSupported).not.toHaveBeenCalled();
      expect(routeFake.verify).not.toHaveBeenCalled();
      expect(routeFake.settle).not.toHaveBeenCalled();
    } finally {
      if (previousDisabled === undefined) delete process.env.D2A_PAYMENTS_DISABLED;
      else process.env.D2A_PAYMENTS_DISABLED = previousDisabled;
      if (previousEnabled === undefined) delete process.env.D2A_SCORE_ENABLED;
      else process.env.D2A_SCORE_ENABLED = previousEnabled;
      jest.dontMock("@/lib/d2a/x402Server");
      jest.resetModules();
    }
  });

  it.each(["PAYMENT-SIGNATURE", "X-PAYMENT"])(
    "allows only one concurrent handler for the same payment via %s",
    async (paymentHeader) => {
    const requirementFake = new FakeFacilitator();
    const requirementHarness = harness(
      requirementFake,
      async () => NextResponse.json({ ok: true }),
    );
    const payment = await paymentFor(requirementHarness.endpoint);
    const [firstEncoding, secondEncoding] = equivalentPaymentEncodings(payment);

    const routeFake = new FakeFacilitator();
    const routeServer = new x402ResourceServer(strictFacilitatorClient(routeFake))
      .register(NETWORK, new ExactEvmScheme());
    const reservedIdentities = new Set<string>();
    const acquirePaymentWork = jest.fn(async (identity: string) => {
      if (reservedIdentities.has(identity)) return false;
      reservedIdentities.add(identity);
      return true;
    });
    const canonicalPaymentIdentity = jest.fn(realCanonicalPaymentIdentity);
    const scoreOneText = jest.fn().mockResolvedValue({
      originality: 7,
      insight: 8,
      credibility: 9,
      composite: 7,
      verdict: "quality",
      reason: "Useful",
      topics: ["technology"],
      vSignal: 8,
      cContext: 5,
      lSlop: 1.5,
      tier: "claude",
    });
    const previousEnv = { ...process.env };
    process.env.D2A_SCORE_ENABLED = "true";
    delete process.env.D2A_SCORE_FREE_ENABLED;
    delete process.env.D2A_PAYMENTS_DISABLED;
    process.env.ANTHROPIC_API_KEY = "test-key";
    jest.resetModules();
    jest.doMock("@/lib/d2a/x402Server", () => ({
      X402_NETWORK: NETWORK,
      X402_RECEIVER: RECEIVER,
      X402_SCORE_PRICE: "$0.02",
      resourceServer: routeServer,
    }));
    jest.doMock("@/lib/d2a/settlementJournal", () => ({
      acquirePaymentWork,
      canonicalPaymentIdentity,
      readPaymentDurableState: jest.fn().mockResolvedValue({ final: null, claim: null }),
    }));
    jest.doMock("@/lib/api/rateLimit", () => ({
      distributedRateLimitByKey: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock("@/lib/api/kv/namespace", () => ({
      scoreCacheKV: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue("OK"),
      },
    }));
    jest.doMock("@/lib/extraction/extractArticle.server", () => ({
      extractArticle: jest.fn().mockResolvedValue({
        status: 200,
        data: {
          title: "Example",
          content: "A sufficiently long article body for scoring.",
          source: "example.com",
        },
      }),
    }));
    jest.doMock("@/lib/api/dailyBudget", () => ({
      tryReserveScoreBudget: jest.fn().mockResolvedValue(true),
      getScoreBudgetRetryAfter: jest.fn().mockResolvedValue(60),
    }));
    jest.doMock("@/lib/scoring/scoreWithClaude.server", () => ({ scoreOneText }));
    jest.doMock("@sentry/nextjs", () => ({
      addBreadcrumb: jest.fn(),
      captureException: jest.fn(),
      captureMessage: jest.fn(),
    }));
    try {
      const actualRoute = require("@/app/api/d2a/score/route") as
        typeof import("@/app/api/d2a/score/route");
      const responses = await Promise.all([
        actualRoute.GET(request(firstEncoding, "https://example.com/one", paymentHeader)),
        actualRoute.GET(request(secondEncoding, "https://example.net/two", paymentHeader)),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 503]);
      const inProgress = responses.find((response) => response.status === 503);
      expect(await inProgress?.json()).toEqual(expect.objectContaining({
        reason: "payment_in_progress",
      }));
      expect(inProgress?.headers.get("Retry-After")).toBe("10");
      expect(acquirePaymentWork).toHaveBeenCalledTimes(2);
      expect(canonicalPaymentIdentity).toHaveBeenCalledTimes(2);
      expect(reservedIdentities.size).toBe(1);
      expect(scoreOneText).toHaveBeenCalledTimes(1);
      expect(routeFake.verify).toHaveBeenCalledTimes(2);
      expect(routeFake.settle).toHaveBeenCalledTimes(1);
    } finally {
      process.env = { ...previousEnv };
      for (const moduleName of [
        "@/lib/d2a/x402Server",
        "@/lib/d2a/settlementJournal",
        "@/lib/api/rateLimit",
        "@/lib/api/kv/namespace",
        "@/lib/extraction/extractArticle.server",
        "@/lib/api/dailyBudget",
        "@/lib/scoring/scoreWithClaude.server",
        "@sentry/nextjs",
      ]) jest.dontMock(moduleName);
      jest.resetModules();
    }
    },
  );

  it("rejects a resend after failed settlement without running the LLM again", async () => {
    const requirementFake = new FakeFacilitator();
    const requirementHarness = harness(
      requirementFake,
      async () => NextResponse.json({ ok: true }),
    );
    const payment = await paymentFor(requirementHarness.endpoint);

    const routeFake = new FakeFacilitator();
    routeFake.settle.mockResolvedValue({
      success: false,
      transaction: "",
      network: NETWORK,
      errorReason: "settlement failed",
    });
    const routeServer = new x402ResourceServer(strictFacilitatorClient(routeFake))
      .register(NETWORK, new ExactEvmScheme());
    let durableClaim = false;
    routeServer.onBeforeSettle(async () => {
      durableClaim = true;
    });
    const acquirePaymentWork = jest.fn().mockResolvedValue(true);
    const readPaymentDurableState = jest.fn(async () => ({
      final: null,
      claim: durableClaim ? { attemptToken: "attempt", createdAt: 1 } : null,
    }));
    const scoreOneText = jest.fn().mockResolvedValue({
      originality: 7,
      insight: 8,
      credibility: 9,
      composite: 7,
      verdict: "quality",
      reason: "Useful",
      topics: ["technology"],
      vSignal: 8,
      cContext: 5,
      lSlop: 1.5,
      tier: "claude",
    });
    const extractArticle = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        title: "Example",
        content: "A sufficiently long article body for scoring.",
        source: "example.com",
      },
    });
    const tryReserveScoreBudget = jest.fn().mockResolvedValue(true);
    const previousEnv = { ...process.env };
    process.env.D2A_SCORE_ENABLED = "true";
    delete process.env.D2A_SCORE_FREE_ENABLED;
    delete process.env.D2A_PAYMENTS_DISABLED;
    process.env.ANTHROPIC_API_KEY = "test-key";
    jest.resetModules();
    jest.doMock("@/lib/d2a/x402Server", () => ({
      X402_NETWORK: NETWORK,
      X402_RECEIVER: RECEIVER,
      X402_SCORE_PRICE: "$0.02",
      resourceServer: routeServer,
    }));
    jest.doMock("@/lib/d2a/settlementJournal", () => ({
      acquirePaymentWork,
      canonicalPaymentIdentity: realCanonicalPaymentIdentity,
      readPaymentDurableState,
    }));
    jest.doMock("@/lib/api/rateLimit", () => ({
      distributedRateLimitByKey: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock("@/lib/api/kv/namespace", () => ({
      scoreCacheKV: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue("OK"),
      },
    }));
    jest.doMock("@/lib/extraction/extractArticle.server", () => ({ extractArticle }));
    jest.doMock("@/lib/api/dailyBudget", () => ({
      tryReserveScoreBudget,
      getScoreBudgetRetryAfter: jest.fn().mockResolvedValue(60),
    }));
    jest.doMock("@/lib/scoring/scoreWithClaude.server", () => ({ scoreOneText }));
    jest.doMock("@sentry/nextjs", () => ({
      addBreadcrumb: jest.fn(),
      captureException: jest.fn(),
      captureMessage: jest.fn(),
    }));
    try {
      const actualRoute = require("@/app/api/d2a/score/route") as
        typeof import("@/app/api/d2a/score/route");

      const first = await actualRoute.GET(request(payment, "https://example.com/first"));
      const resend = await actualRoute.GET(request(payment, "https://example.net/resend"));

      expect(first.status).toBe(402);
      expect(resend.status).toBe(409);
      expect(await resend.json()).toEqual(expect.objectContaining({
        reason: "payment_already_used",
      }));
      expect(readPaymentDurableState).toHaveBeenCalledTimes(2);
      expect(acquirePaymentWork).toHaveBeenCalledTimes(1);
      expect(extractArticle).toHaveBeenCalledTimes(1);
      expect(tryReserveScoreBudget).toHaveBeenCalledTimes(1);
      expect(scoreOneText).toHaveBeenCalledTimes(1);
      expect(routeFake.verify).toHaveBeenCalledTimes(2);
      expect(routeFake.settle).toHaveBeenCalledTimes(1);
    } finally {
      process.env = { ...previousEnv };
      for (const moduleName of [
        "@/lib/d2a/x402Server",
        "@/lib/d2a/settlementJournal",
        "@/lib/api/rateLimit",
        "@/lib/api/kv/namespace",
        "@/lib/extraction/extractArticle.server",
        "@/lib/api/dailyBudget",
        "@/lib/scoring/scoreWithClaude.server",
        "@sentry/nextjs",
      ]) jest.dontMock(moduleName);
      jest.resetModules();
    }
  });

  it("(h) decorates wrapper-generated 402 responses with CORS and no-store", async () => {
    const fake = new FakeFacilitator();
    const { endpoint } = harness(fake, async () => NextResponse.json({ ok: true }));

    const response = await endpoint(request());
    expect(response.status).toBe(402);
    expect(response.headers.get("Access-Control-Allow-Origin"))
      .toBe("https://aegis.dwebxr.xyz");
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  });
});
