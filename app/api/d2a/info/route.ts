import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import { X402_NETWORK, X402_PRICE, X402_RECEIVER } from "@/lib/d2a/x402Server";

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const info = {
    name: "Aegis",
    description: "D2A Social Agent Platform — AI-curated content briefings with V/C/L scoring",
    version: "1.0",
    sourceUrl: "https://aegis.dwebxr.xyz",
    endpoints: {
      briefing: {
        url: "/api/d2a/briefing",
        method: "GET",
        auth: "x402",
        price: X402_PRICE,
        network: X402_NETWORK,
        currency: "USDC",
        description: "Get curated briefing with scored content items",
        params: {
          principal: "(optional) IC principal for user-specific briefing",
        },
      },
      info: {
        url: "/api/d2a/info",
        method: "GET",
        auth: "none",
        description: "Service metadata (this endpoint)",
      },
      health: {
        url: "/api/d2a/health",
        method: "GET",
        auth: "none",
        description: "Service health check",
      },
    },
    payment: {
      protocol: "x402",
      facilitator: (process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator").trim(),
      receiver: X402_RECEIVER || "not configured",
      network: X402_NETWORK,
      price: X402_PRICE,
      currency: "USDC",
      usdcContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
    scoring: {
      model: "aegis-vcl-v1",
      axes: {
        V_signal: "Information density & novelty (0-10)",
        C_context: "User interest relevance (0-10)",
        L_slop: "Clickbait/engagement farming (0-10)",
      },
      legacy: {
        originality: "Novel vs. rehashed (0-10)",
        insight: "Deep analysis vs. surface (0-10)",
        credibility: "Source reliability (0-10)",
        composite: "Weighted final score (0-10)",
      },
    },
    compatibility: {
      erc8004: false,
      x402Version: 2,
    },
  };

  return withCors(NextResponse.json(info), request.headers.get("origin"));
}

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
