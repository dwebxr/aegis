import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { rateLimit } from "@/lib/api/rateLimit";
import { getLatestBriefing } from "@/lib/d2a/briefingProvider";
import { resourceServer, X402_NETWORK, X402_PRICE, X402_RECEIVER } from "@/lib/d2a/x402Server";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";

export const maxDuration = 30;

async function handleGet(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const principal = request.nextUrl.searchParams.get("principal") || undefined;

  try {
    const briefing = await getLatestBriefing(principal);
    if (!briefing) {
      return withCors(
        NextResponse.json(
          { error: "No briefing available", hint: "User has no briefing data yet" },
          { status: 404 },
        ),
        request.headers.get("origin"),
      );
    }

    return withCors(
      NextResponse.json(briefing),
      request.headers.get("origin"),
    );
  } catch (error) {
    console.error("[d2a/briefing] Error:", error);
    return withCors(
      NextResponse.json({ error: "Failed to fetch briefing" }, { status: 500 }),
      request.headers.get("origin"),
    );
  }
}

// x402-gated GET: requires USDC payment on Base
export const GET = X402_RECEIVER
  ? withX402(
      handleGet,
      {
        accepts: {
          scheme: "exact",
          price: X402_PRICE,
          network: X402_NETWORK,
          payTo: X402_RECEIVER,
          maxTimeoutSeconds: 60,
        },
        description: "Aegis curated briefing — AI-scored content feed with V/C/L metrics",
      },
      resourceServer,
    )
  : handleGet; // Ungated fallback when no receiver configured

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
