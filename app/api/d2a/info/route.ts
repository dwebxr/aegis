import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import { X402_NETWORK, X402_PRICE, X402_RECEIVER } from "@/lib/d2a/x402Server";
import { APP_URL } from "@/lib/config";

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const res = NextResponse.json({
    name: "Aegis",
    description: "D2A Social Agent Platform — AI-curated content briefings with V/C/L scoring",
    version: "1.0",
    sourceUrl: APP_URL,
    specUrl: "https://github.com/dwebxr/aegis/blob/main/docs/D2A_PROTOCOL.md",
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
          since: "(optional) ISO 8601 — exclude briefings generated before this timestamp",
          limit: "(optional) max items to return (default 50, max 100; global path: default 5, max 10)",
          offset: "(optional) pagination offset (default 0)",
          topics: "(optional) comma-separated topic filter (case-insensitive, OR logic)",
          preview: "(optional) 'true' to get truncated content without x402 payment (requires X402_FREE_TIER_ENABLED)",
        },
      },
      changes: {
        url: "/api/d2a/briefing/changes",
        method: "GET",
        auth: "none",
        description: "Lightweight diff endpoint — returns item hashes from briefings newer than since",
        params: {
          since: "(required) ISO 8601 timestamp",
        },
      },
      info: { url: "/api/d2a/info", method: "GET", auth: "none" },
      health: { url: "/api/d2a/health", method: "GET", auth: "none" },
    },
    payment: {
      protocol: "x402",
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
    compatibility: { x402Version: 2 },
  });
  res.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
  return withCors(res, request.headers.get("origin"));
}

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
