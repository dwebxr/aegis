import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { distributedRateLimit } from "@/lib/api/rateLimit";
import { buildBriefingResponse } from "@/lib/d2a/briefingHandler";
import { resourceServer, X402_NETWORK, X402_PRICE, X402_RECEIVER } from "@/lib/d2a/x402Server";
import { corsOptionsResponse } from "@/lib/d2a/cors";
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
  description: "Aegis curated briefing — AI-scored content feed with V/C/L metrics",
};

async function handleGet(request: NextRequest): Promise<NextResponse> {
  const limited = await distributedRateLimit(request, 30, 60);
  if (limited) return limited;

  return buildBriefingResponse(request);
}

// Receiver configured → x402 paywall; receiver unset → served free. Free-when-unset
// is INTENTIONAL: this deployment runs the briefing free (no EVM receiver). Do not
// "harden" the unset branch to 503 — that breaks the operator's free-access usage.
const dispatchGet = X402_RECEIVER
  ? X402_FREE_TIER
    ? async (request: NextRequest) => {
        if (request.nextUrl.searchParams.get("preview") === "true") return handleGet(request);
        return withX402(handleGet, x402Config, resourceServer)(request);
      }
    : withX402(handleGet, x402Config, resourceServer)
  : handleGet;

// Never let a CDN/edge cache this endpoint: a cached paid or principal-specific
// briefing could be served to an unpaid/other client (x402 cache-leakage, Attack III).
export const GET = async (request: NextRequest): Promise<Response> => {
  const res = await dispatchGet(request);
  res.headers.set("Cache-Control", "no-store, private");
  return res;
};

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
