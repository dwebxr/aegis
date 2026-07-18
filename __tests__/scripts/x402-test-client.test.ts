import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentRequired, SettleResponse } from "@x402/core/types";
import { verifyTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runX402Test, type FetchLike } from "@/scripts/x402-test-client";

const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const ENDPOINT = "https://aegis.test/api/d2a/score?url=https://example.com";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const TX_HASH = `0x${"22".repeat(32)}` as Hex;

const paymentRequired: PaymentRequired = {
  x402Version: 2,
  resource: {
    url: ENDPOINT,
    description: "Score a URL",
    mimeType: "application/json",
  },
  accepts: [{
    scheme: "exact",
    network: "eip155:84532",
    asset: USDC,
    amount: "20000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  }],
};

const settlement: SettleResponse = {
  success: true,
  payer: privateKeyToAccount(PRIVATE_KEY).address,
  transaction: TX_HASH,
  network: "eip155:84532",
};

describe("runX402Test", () => {
  it("decodes 402, signs accepts[0], attaches the header, and decodes settlement", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    let requestNumber = 0;
    let encodedPayment = "";
    const fetchMock: FetchLike = jest.fn(async (_input, init) => {
      requestNumber += 1;
      if (requestNumber === 1) {
        return new Response(JSON.stringify({ error: "payment required" }), {
          status: 402,
          headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired) },
        });
      }

      encodedPayment = new Headers(init?.headers).get("PAYMENT-SIGNATURE") ?? "";
      return new Response(JSON.stringify({ score: 91, echoed: encodedPayment }, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "PAYMENT-RESPONSE": encodePaymentResponseHeader(settlement),
        },
      });
    });

    const result = await runX402Test(ENDPOINT, account, fetchMock);

    expect(fetchMock).toHaveBeenNthCalledWith(1, ENDPOINT, { method: "GET" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, ENDPOINT, {
      method: "GET",
      headers: { "PAYMENT-SIGNATURE": expect.any(String) },
    });
    expect(encodedPayment).not.toBe("");

    const payload = decodePaymentSignatureHeader(encodedPayment);
    const authorization = payload.payload.authorization as Record<string, string>;
    const signature = payload.payload.signature as Hex;
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toEqual(paymentRequired.accepts[0]);
    expect(authorization).toEqual(expect.objectContaining({
      from: account.address,
      to: PAY_TO,
      value: "20000",
      nonce: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    }));
    await expect(verifyTypedData({
      address: account.address,
      domain: {
        name: "USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: USDC,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from as Address,
        to: authorization.to as Address,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce as Hex,
      },
      signature,
    })).resolves.toBe(true);

    expect(result).toEqual(expect.objectContaining({
      payer: account.address,
      accepted: paymentRequired.accepts[0],
      status: 200,
      paymentResponse: {
        success: true,
        payer: account.address,
        network: "eip155:84532",
        txHash: TX_HASH,
      },
      ok: true,
    }));
    expect(result.verification).toEqual({
      network: "eip155:84532",
      txHash: TX_HASH,
      payer: account.address,
      payTo: PAY_TO,
      amount: "20000",
      nonce: authorization.nonce,
      validBefore: authorization.validBefore,
    });
    expect(result.bodySummary).toContain("[REDACTED_PAYMENT_PAYLOAD]");
    expect(result.bodySummary).not.toContain(encodedPayment);
  });

  it("fails the success criterion when a 200 response has no transaction hash", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 402,
        headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired) },
      }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const result = await runX402Test(ENDPOINT, account, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.paymentResponse).toBeUndefined();
    expect(result.paymentResponseError).toBe("PAYMENT-RESPONSE header is missing");
    expect(result.verification.txHash).toBeUndefined();
  });
});
