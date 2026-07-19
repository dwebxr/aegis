import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { distributedRateLimit } from "@/lib/api/rateLimit";
import { BRIEFING_BAZAAR_METADATA } from "@/lib/d2a/bazaar";
import { buildBriefingResponse } from "@/lib/d2a/briefingHandler";
import { resourceServer, X402_NETWORK, X402_PRICE, X402_RECEIVER } from "@/lib/d2a/x402Server";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import { isFeatureEnabled } from "@/lib/featureFlags";

export const maxDuration = 30;

const X402_FREE_TIER = isFeatureEnabled("x402FreeTier");

const x402Config = {
  accepts: {
    scheme: "exact" as const,
    price: X402_PRICE,
    network: X402_NETWORK,
    payTo: X402_RECEIVER,
    maxTimeoutSeconds: 60,
  },
  ...BRIEFING_BAZAAR_METADATA,
};

async function handleGet(request: NextRequest): Promise<NextResponse> {
  const limited = await distributedRateLimit(request, 30, 60);
  if (limited) return limited;

  return buildBriefingResponse(request);
}

// Receiver configured → x402 paywall; receiver unset → served free. Free-when-unset
// is INTENTIONAL: this deployment runs the briefing free (no EVM receiver). Do not
// "harden" the unset branch to 503 — that breaks the operator's free-access usage.
type BriefingHandler = (request: NextRequest) => Promise<NextResponse>;
let paidHandler: BriefingHandler | null = null;

function getPaidHandler(): BriefingHandler {
  if (!paidHandler) paidHandler = withX402(handleGet, x402Config, resourceServer);
  return paidHandler;
}

function dispatchGet(request: NextRequest): Promise<NextResponse> {
  if (!X402_RECEIVER) return handleGet(request);
  if (X402_FREE_TIER && request.nextUrl.searchParams.get("preview") === "true") {
    return handleGet(request);
  }
  return getPaidHandler()(request);
}

// Never let a CDN/edge cache this endpoint: a cached paid or principal-specific
// briefing could be served to an unpaid/other client (x402 cache-leakage, Attack III).
export const GET = async (request: NextRequest): Promise<Response> => {
  if (process.env.D2A_PAYMENTS_DISABLED === "true") {
    const disabled = withCors(
      NextResponse.json(
        { error: "D2A payments are disabled", reason: "payments_disabled" },
        { status: 503 },
      ),
      request.headers.get("origin"),
    );
    disabled.headers.set("Cache-Control", "no-store, private");
    return disabled;
  }
  const res = await dispatchGet(request);
  res.headers.set("Cache-Control", "no-store, private");
  return res;
};

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
