import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import type { PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { Address, Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const BODY_SUMMARY_LIMIT = 800;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface PaymentResponseSummary {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  network: string;
  amount?: string;
  txHash?: Hex;
}

export interface VerificationValues {
  network: string;
  txHash?: Hex;
  payer: Address;
  payTo: string;
  amount: string;
  nonce?: Hex;
  validBefore?: string;
}

export interface X402TestResult {
  payer: Address;
  accepted: PaymentRequirements;
  status: number;
  bodySummary: string;
  paymentResponse?: PaymentResponseSummary;
  paymentResponseError?: string;
  verification: VerificationValues;
  ok: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTxHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function summarizeBody(body: string, redactions: string[] = []): string {
  let summary = body.trim();
  for (const value of redactions) {
    if (value) summary = summary.split(value).join("[REDACTED_PAYMENT_PAYLOAD]");
  }
  summary = summary.replace(/\s+/g, " ");
  if (!summary) return "(empty)";
  if (summary.length <= BODY_SUMMARY_LIMIT) return summary;
  return `${summary.slice(0, BODY_SUMMARY_LIMIT - 3)}...`;
}

function summarizeSettlement(settlement: SettleResponse): PaymentResponseSummary {
  return {
    success: settlement.success,
    ...(settlement.errorReason ? { errorReason: settlement.errorReason } : {}),
    ...(settlement.errorMessage ? { errorMessage: settlement.errorMessage } : {}),
    ...(settlement.payer ? { payer: settlement.payer } : {}),
    network: settlement.network,
    ...(settlement.amount ? { amount: settlement.amount } : {}),
    ...(isTxHash(settlement.transaction) ? { txHash: settlement.transaction } : {}),
  };
}

function authorizationValues(payload: Record<string, unknown>): {
  nonce?: Hex;
  validBefore?: string;
} {
  const authorization = payload.authorization;
  if (!isRecord(authorization)) return {};
  return {
    ...(isTxHash(authorization.nonce) ? { nonce: authorization.nonce } : {}),
    ...(typeof authorization.validBefore === "string"
      ? { validBefore: authorization.validBefore }
      : {}),
  };
}

export async function runX402Test(
  url: string,
  account: PrivateKeyAccount,
  fetchImpl: FetchLike = fetch,
): Promise<X402TestResult> {
  const coreClient = new x402Client()
    .register("eip155:*", new ExactEvmScheme(account));
  const httpClient = new x402HTTPClient(coreClient);

  const unpaid = await fetchImpl(url, { method: "GET" });
  if (unpaid.status !== 402) {
    throw new Error(`Expected unpaid request to return 402, received ${unpaid.status}`);
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => unpaid.headers.get(name),
  );
  const accepted = paymentRequired.accepts[0];
  if (!accepted) throw new Error("PAYMENT-REQUIRED accepts[0] is missing");
  if (accepted.scheme !== "exact") {
    throw new Error(`PAYMENT-REQUIRED accepts[0] scheme must be exact, received ${accepted.scheme}`);
  }
  if (!/^eip155:\d+$/.test(accepted.network)) {
    throw new Error(`PAYMENT-REQUIRED accepts[0] is not an EVM network: ${accepted.network}`);
  }

  // Restrict selection to the advertised first option so the displayed terms
  // are exactly the terms that get signed.
  const paymentPayload = await httpClient.createPaymentPayload({
    ...paymentRequired,
    accepts: [accepted],
  });
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const paid = await fetchImpl(url, { method: "GET", headers: paymentHeaders });
  const body = await paid.text();
  const encodedPayload = paymentHeaders["PAYMENT-SIGNATURE"]
    ?? paymentHeaders["X-PAYMENT"]
    ?? "";

  let settlement: SettleResponse | undefined;
  let paymentResponseError: string | undefined;
  if (paid.headers.get("PAYMENT-RESPONSE") || paid.headers.get("X-PAYMENT-RESPONSE")) {
    try {
      settlement = httpClient.getPaymentSettleResponse((name) => paid.headers.get(name));
    } catch (error) {
      paymentResponseError = `PAYMENT-RESPONSE decode failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  } else {
    paymentResponseError = "PAYMENT-RESPONSE header is missing";
  }

  const paymentResponse = settlement ? summarizeSettlement(settlement) : undefined;
  const txHash = paymentResponse?.txHash;
  const authorization = authorizationValues(paymentPayload.payload);
  return {
    payer: account.address,
    accepted,
    status: paid.status,
    bodySummary: summarizeBody(body, [encodedPayload]),
    ...(paymentResponse ? { paymentResponse } : {}),
    ...(paymentResponseError ? { paymentResponseError } : {}),
    verification: {
      network: accepted.network,
      ...(txHash ? { txHash } : {}),
      payer: account.address,
      payTo: accepted.payTo,
      amount: accepted.amount,
      ...authorization,
    },
    ok: paid.status === 200 && txHash !== undefined,
  };
}

function args(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument: ${key}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function endpointUrl(value: string | undefined): string {
  if (!value) throw new Error("--url is required");
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("--url must use http or https");
  }
  return value;
}

function privateKey(value: string | undefined): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("EVM_PRIVATE_KEY must be a 0x-prefixed 32-byte private key");
  }
  return value as Hex;
}

function safeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  const secret = process.env.EVM_PRIVATE_KEY;
  if (secret) message = message.split(secret).join("[REDACTED]");
  return message;
}

async function main(): Promise<void> {
  const options = args(process.argv.slice(2));
  const url = endpointUrl(options.url);
  const account = privateKeyToAccount(privateKey(process.env.EVM_PRIVATE_KEY));
  const result = await runX402Test(url, account);

  console.log(`Payer: ${result.payer}`);
  console.log("PAYMENT-REQUIRED accepts[0]:");
  console.log(JSON.stringify(result.accepted, null, 2));
  console.log("Paid response:");
  console.log(JSON.stringify({
    status: result.status,
    bodySummary: result.bodySummary,
    paymentResponse: result.paymentResponse ?? null,
    paymentResponseError: result.paymentResponseError ?? null,
  }, null, 2));
  console.log("verify-settlement values (signature omitted):");
  console.log(JSON.stringify(result.verification, null, 2));
  console.log(`Result: ${result.ok ? "SUCCESS" : "FAILED"}`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
}
