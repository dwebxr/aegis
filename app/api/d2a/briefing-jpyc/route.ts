import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/api/rateLimit";
import { buildBriefingResponse } from "@/lib/d2a/briefingHandler";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import {
  fetchAccepts,
  facilitatorVerify,
  facilitatorSettle,
  json402,
  openpayConfigError,
  parsePaymentHeader,
  type ParsedPayment,
} from "@/lib/d2a/openpayGate";
import {
  acquireLock,
  claimPending,
  extractAuthorization,
  fetchUsdcFace,
  LOCK_TTL_S,
  logUsdcEvent,
  matchesAdvertisedRequirements,
  parseV2PaymentHeader,
  paymentIdentity,
  readPaymentState,
  relaySettle,
  relayVerify,
  releaseLock,
  usdcRailConfig,
  writePaymentState,
  type Rail,
  type RelayInput,
} from "@/lib/d2a/openpayUsdc";
import { isFeatureEnabled } from "@/lib/featureFlags";

// Worst case: requirements 5s ∥ discovery 5s + verify 10s + content 20s +
// settle 15s = 50s. Settle is not started after 40s, keeping it inside budget.
export const maxDuration = 60;

const X402_FREE_TIER = isFeatureEnabled("x402FreeTier");
const SETTLE_DEADLINE_MS = 40_000;

/** JPYC or opt-in USDC-paid briefing via OpenPay.
 *
 *  The charging-safe order is:
 *  1. rate limit           — unauthenticated traffic must not drive facilitator calls
 *  2. free-tier preview    — same bypass semantics as /api/d2a/briefing
 *  3. config + requirements— fail closed (503) when the selected gate can't operate
 *  4. verify               — no funds move at verify
 *  5. BUILD CONTENT        — any 4xx/5xx returns here, BEFORE settlement, so a
 *                            failed request is never charged
 *  6. settle               — funds move only once deliverable content is in hand
 *
 *  USDC state is none → pending → settled | rejected | unknown. A pending state
 *  at least 150s old is orphaned and requires reconciliation. After a settle
 *  attempt, 402 is returned only for allowlisted, definitely-unbroadcast failures.
 */
async function handleGet(request: NextRequest): Promise<NextResponse> {
  // The settle deadline is measured from function entry: the rate-limit KV
  // round-trip below is part of the 60s budget too.
  const startedAt = Date.now();
  const limited = await distributedRateLimit(request, 30, 60);
  if (limited) return limited;

  if (X402_FREE_TIER && request.nextUrl.searchParams.get("preview") === "true") {
    return buildBriefingResponse(request);
  }

  const configError = openpayConfigError();
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 503 });
  }

  if (!usdcRailConfig().enabled) return handleJpycLegacy(request);

  const signatureHeader = request.headers.get("payment-signature");
  const paymentHeader = request.headers.get("x-payment");
  if (signatureHeader && paymentHeader) {
    return NextResponse.json(
      { x402Version: 1, accepts: [], error: "ambiguous_payment" },
      { status: 402 },
    );
  }
  if (signatureHeader) {
    return handleUsdc(
      request,
      "usdc-v2",
      { paymentSignatureHeader: signatureHeader },
      parseV2PaymentHeader(signatureHeader),
      startedAt,
    );
  }
  if (paymentHeader) {
    const parsed = parsePaymentHeader(paymentHeader);
    if (parsed.ok && parsed.payload.network === "base") {
      return handleUsdc(
        request,
        "usdc-v1",
        { paymentHeader },
        parsed,
        startedAt,
      );
    }
    return handleJpycLegacy(request);
  }
  return handleChallenge();
}

async function handleJpycLegacy(request: NextRequest): Promise<NextResponse> {
  // Any payment header means these terms may be verified and settled, so they
  // must be recent; a bare request only gets a 402 and can use older terms.
  const hasPayment = Boolean(request.headers.get("x-payment") || request.headers.get("payment-signature"));
  const accepts = await fetchAccepts(hasPayment ? "payment" : "challenge");
  if (!accepts) {
    return NextResponse.json({ error: "OpenPay resource not available" }, { status: 503 });
  }

  const header = request.headers.get("x-payment");
  if (!header) return json402(accepts, "payment_required");

  const parsed = parsePaymentHeader(header);
  if (!parsed.ok) return json402(accepts, parsed.error);

  // The single validated accept is used for the 402 body, verify AND settle, so
  // the requirements a client paid against are exactly the ones we settle.
  const accept = accepts[0];

  const verify = await facilitatorVerify(parsed.payload, accept);
  if (!verify.ok) return json402(accepts, verify.error);

  const content = await buildBriefingResponse(request);
  if (content.status >= 400) return content;

  const settle = await facilitatorSettle(parsed.payload, accept);
  if (!settle.ok) return json402(accepts, settle.error);

  content.headers.set("X-PAYMENT-RESPONSE", settle.paymentResponseHeader);
  return content;
}

async function handleChallenge(): Promise<NextResponse> {
  const [accepts, face] = await Promise.all([fetchAccepts("challenge"), fetchUsdcFace("challenge")]);
  if (!accepts && !face) {
    return NextResponse.json({ error: "OpenPay resource not available" }, { status: 503 });
  }
  return json402(
    [...(accepts ?? []), ...(face ? [face.v1Accepts] : [])],
    "payment_required",
    face?.paymentRequiredHeader,
  );
}

function retryResponse(seconds: number): NextResponse {
  const response = NextResponse.json(
    { error: "payment_in_progress", reason: "payment_in_progress" },
    { status: 503 },
  );
  response.headers.set("Retry-After", String(seconds));
  return response;
}

function unavailableResponse(
  error: string,
  reason: string,
  retryAfter?: number,
): NextResponse {
  const response = NextResponse.json({ error, reason }, { status: 503 });
  if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

async function handleUsdc(
  request: NextRequest,
  rail: Rail,
  input: RelayInput,
  parsed: ParsedPayment,
  startedAt: number,
): Promise<NextResponse> {
  if (!parsed.ok) {
    logUsdcEvent(rail, "match", "rejected", startedAt, undefined, parsed.error);
    return json402([], "invalid_payment_payload");
  }

  const auth = extractAuthorization(parsed.payload);
  if (!auth) {
    logUsdcEvent(rail, "match", "rejected", startedAt, undefined, "invalid_payment_payload");
    return json402([], "invalid_payment_payload");
  }
  const identity = paymentIdentity(auth);

  // Durable state is checked before current requirements: a replay remains a
  // replay after a price revision and must not prompt a fresh authorization.
  const durable = await readPaymentState(identity);
  if (durable.kind === "unavailable") {
    logUsdcEvent(rail, "state", "unavailable", startedAt, identity, "payment_in_progress");
    return retryResponse(10);
  }
  if (durable.kind === "state") {
    if (durable.state.status === "settled") {
      logUsdcEvent(rail, "state", "rejected", startedAt, identity, "payment_already_used");
      return NextResponse.json(
        { error: "This payment has already been used", reason: "payment_already_used" },
        { status: 409 },
      );
    }
    if (durable.state.status === "pending") {
      if (Date.now() - durable.state.at < LOCK_TTL_S * 1000) {
        logUsdcEvent(rail, "state", "busy", startedAt, identity, "payment_in_progress");
        return retryResponse(30);
      }
      logUsdcEvent(rail, "state", "unknown", startedAt, identity, "settlement_unknown");
      return unavailableResponse("settlement_unknown", "settlement_unknown");
    }
    if (durable.state.status === "unknown") {
      logUsdcEvent(rail, "state", "unknown", startedAt, identity, "settlement_unknown");
      return unavailableResponse("settlement_unknown", "settlement_unknown");
    }
  }
  // A rejected record means no funds moved, so the same authorization may try
  // again — but the record still occupies the state key, and the SET NX claim
  // below would read it as "someone else is settling". Remember to overwrite.
  const resumingFromRejected = durable.kind === "state" && durable.state.status === "rejected";
  logUsdcEvent(rail, "state", resumingFromRejected ? "rejected" : "clear", startedAt, identity);

  const face = await fetchUsdcFace("payment");
  if (!face) {
    logUsdcEvent(rail, "face", "unavailable", startedAt, identity);
    return NextResponse.json({ error: "OpenPay USDC rail not available" }, { status: 503 });
  }
  logUsdcEvent(rail, "face", "accepted", startedAt, identity);

  const match = matchesAdvertisedRequirements(
    rail,
    parsed.payload,
    auth,
    face,
    Math.floor(Date.now() / 1000),
  );
  if (!match.ok) {
    logUsdcEvent(rail, "match", "rejected", startedAt, identity, match.error);
    return json402([face.v1Accepts], match.error, face.paymentRequiredHeader);
  }
  logUsdcEvent(rail, "match", "accepted", startedAt, identity);

  const lock = await acquireLock(identity);
  if (lock !== "acquired") {
    logUsdcEvent(rail, "lock", lock, startedAt, identity, "payment_in_progress");
    return retryResponse(10);
  }
  logUsdcEvent(rail, "lock", "acquired", startedAt, identity);

  const verification = await relayVerify(input);
  if (!verification.ok) {
    await releaseLock(identity);
    if (!verification.indeterminate) {
      logUsdcEvent(rail, "verify", "rejected", startedAt, identity, verification.error);
      return json402([face.v1Accepts], verification.error, face.paymentRequiredHeader);
    }
    logUsdcEvent(rail, "verify", "unavailable", startedAt, identity, verification.error);
    return unavailableResponse(verification.error, "verification_unavailable", 10);
  }
  logUsdcEvent(rail, "verify", "accepted", startedAt, identity);

  const content = await buildBriefingResponse(request);
  if (content.status >= 400) {
    await releaseLock(identity);
    logUsdcEvent(rail, "content", "rejected", startedAt, identity, String(content.status));
    return content;
  }
  logUsdcEvent(rail, "content", "ready", startedAt, identity);

  if (Date.now() - startedAt > SETTLE_DEADLINE_MS) {
    await releaseLock(identity);
    logUsdcEvent(
      rail,
      "deadline",
      "exceeded",
      startedAt,
      identity,
      "settlement_deadline_exceeded",
    );
    return unavailableResponse(
      "settlement_deadline_exceeded",
      "settlement_deadline_exceeded",
      5,
    );
  }
  logUsdcEvent(rail, "deadline", "within_budget", startedAt, identity);

  const claimAt = Date.now();
  // The lock held above serializes concurrent copies, so overwriting a
  // rejected record here cannot race another settle of this authorization.
  const claim = resumingFromRejected
    ? (await writePaymentState(identity, { status: "pending", at: claimAt }) ? "claimed" : "unavailable")
    : await claimPending(identity, claimAt);
  if (claim === "exists") {
    await releaseLock(identity);
    logUsdcEvent(rail, "claim", "exists", startedAt, identity, "settlement_unknown");
    return unavailableResponse("settlement_unknown", "settlement_unknown");
  }
  if (claim === "unavailable") {
    await releaseLock(identity);
    logUsdcEvent(rail, "claim", "unavailable", startedAt, identity, "payment_in_progress");
    return retryResponse(10);
  }
  logUsdcEvent(rail, "claim", "claimed", startedAt, identity);

  // KV round-trips are not time-bounded, so re-check right before funds can
  // move: a slow claim must not push settle past the function budget, where a
  // kill mid-settle would leave money moved and nothing recorded or delivered.
  // Nothing was broadcast, so the record becomes `rejected` (retry allowed).
  if (Date.now() - startedAt > SETTLE_DEADLINE_MS) {
    await writePaymentState(identity, {
      status: "rejected",
      at: Date.now(),
      reason: "settlement_deadline_exceeded",
    });
    await releaseLock(identity);
    logUsdcEvent(
      rail,
      "deadline",
      "exceeded_after_claim",
      startedAt,
      identity,
      "settlement_deadline_exceeded",
    );
    return unavailableResponse(
      "settlement_deadline_exceeded",
      "settlement_deadline_exceeded",
      5,
    );
  }

  const settlement = await relaySettle(input, auth);
  if (settlement.ok) {
    await writePaymentState(identity, {
      status: "settled",
      at: Date.now(),
      transaction: settlement.transaction,
    });
    content.headers.set("X-PAYMENT-RESPONSE", settlement.receiptHeader);
    if (rail === "usdc-v2") content.headers.set("PAYMENT-RESPONSE", settlement.receiptHeader);
    logUsdcEvent(rail, "settle", "settled", startedAt, identity);
    return content;
  }

  if (!settlement.indeterminate) {
    await writePaymentState(identity, {
      status: "rejected",
      at: Date.now(),
      reason: settlement.error,
    });
    logUsdcEvent(rail, "settle", "rejected", startedAt, identity, settlement.error);
    return json402([face.v1Accepts], settlement.error, face.paymentRequiredHeader);
  }

  await writePaymentState(identity, {
    status: "unknown",
    at: Date.now(),
    reason: settlement.error,
  });
  logUsdcEvent(rail, "settle", "unknown", startedAt, identity, settlement.error);
  return unavailableResponse(settlement.error, "settlement_unknown");
}

// Every response — success, 402, 429, 503 — gets CORS and is never CDN-cached:
// a cached paid or principal-specific briefing could leak to an unpaid client.
export const GET = async (request: NextRequest): Promise<Response> => {
  const res = await handleGet(request);
  res.headers.set("Cache-Control", "no-store, private");
  return withCors(res, request.headers.get("origin"));
};

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
