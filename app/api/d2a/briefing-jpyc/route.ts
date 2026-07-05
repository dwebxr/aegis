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
} from "@/lib/d2a/openpayGate";
import { isFeatureEnabled } from "@/lib/featureFlags";

// Worst-case chain: discovery 5s + verify 10s + content build + settle 15s.
// 60s keeps the settle leg safely inside the function budget — a Vercel timeout
// mid-settle would mean "charged but no content delivered".
export const maxDuration = 60;

const X402_FREE_TIER = isFeatureEnabled("x402FreeTier");

/** JPYC-paid briefing via OpenPay (x402 v1, Polygon eip155:137).
 *
 *  Order matters:
 *  1. rate limit           — unauthenticated traffic must not drive facilitator calls
 *  2. free-tier preview    — same bypass semantics as /api/d2a/briefing
 *  3. config + catalog     — fail closed (503) when the gate can't operate
 *  4. verify               — no funds move at verify
 *  5. BUILD CONTENT        — any 4xx/5xx returns here, BEFORE settlement, so a
 *                            failed request is never charged
 *  6. settle               — funds move only once deliverable content is in hand
 */
async function handleGet(request: NextRequest): Promise<NextResponse> {
  const limited = await distributedRateLimit(request, 30, 60);
  if (limited) return limited;

  if (X402_FREE_TIER && request.nextUrl.searchParams.get("preview") === "true") {
    return buildBriefingResponse(request);
  }

  const configError = openpayConfigError();
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 503 });
  }

  const accepts = await fetchAccepts();
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
