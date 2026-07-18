import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FacilitatorClient } from "@x402/core/server";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402 } from "@x402/next";
import { NextRequest, NextResponse } from "next/server";
import { withCors } from "@/lib/d2a/cors";
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

function request(payment?: string): NextRequest {
  return new NextRequest("http://localhost/api/d2a/score?url=https%3A%2F%2Fexample.com", {
    method: "GET",
    headers: {
      origin: "https://aegis.dwebxr.xyz",
      ...(payment ? { "PAYMENT-SIGNATURE": payment } : {}),
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
      },
      signature: "0xfake",
    },
  };
  return encodePaymentSignatureHeader(payload);
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
