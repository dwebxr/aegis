import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_STABLECOINS } from "@x402/evm";
import { rateLimit } from "@/lib/api/rateLimit";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import { X402_NETWORK, X402_PRICE, X402_RECEIVER } from "@/lib/d2a/x402Server";
import { OPENPAY_MERCHANT, OPENPAY_URL } from "@/lib/d2a/openpayGate";
import { APP_URL } from "@/lib/config";

// Same registry the ExactEvmScheme paywall settles against — keeps the advertised
// asset in lockstep with the one actually demanded in the 402 payment requirements
// (a hardcoded Base-mainnet USDC address here once diverged from the Base-Sepolia
// default network and sent agents to the wrong contract; a hardcoded "USDC" label
// would likewise mislabel networks whose default asset is USDT0/MegaUSD/etc.).
// Map lookup, not getDefaultAsset(): that throws for networks without a default
// asset, and this free discovery route must keep serving (reporting the network
// as configured) even when the operator picks a network the paywall can't settle.
const DEFAULT_ASSET = DEFAULT_STABLECOINS[X402_NETWORK] ?? null;
const CURRENCY = DEFAULT_ASSET?.name ?? "unknown";

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
        auth: X402_RECEIVER ? "x402" : "none",
        x402Version: 2,
        price: X402_PRICE,
        network: X402_NETWORK,
        currency: CURRENCY,
        description: "Get curated briefing with scored content items",
        params: {
          principal: "(optional) IC principal — returns that contributor's FULL briefing (content, sourceUrl, reason, full scores). Omitted → global ranked INDEX (topItems: title/sourceUrl/topics/score/verdict; sourceUrl redacted under preview); take principals from contributors[].principal",
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
        auth: X402_RECEIVER ? "x402" : "none",
        x402Version: 2,
        price: X402_PRICE,
        network: X402_NETWORK,
        currency: CURRENCY,
        description: "Lightweight diff endpoint — returns item hashes from briefings newer than since",
        params: {
          since: "(required) ISO 8601 timestamp",
          preview: "(optional) 'true' to get hash-only diff (title/sourceUrl redacted) without x402 payment (requires X402_FREE_TIER_ENABLED)",
        },
      },
      briefingJpyc: {
        url: "/api/d2a/briefing-jpyc",
        method: "GET",
        // "unavailable" (not "none") when the merchant is unset: unlike briefing's
        // free-when-unset fallback, this route serves nothing without its gate (503).
        auth: OPENPAY_MERCHANT ? "x402" : "unavailable",
        x402Version: 1,
        network: "eip155:137",
        currency: "JPYC",
        price: "per OpenPay catalog — the 402 accepts payload is authoritative",
        facilitator: OPENPAY_URL,
        description:
          "JPYC-paid curated briefing via OpenPay (OpenPay-flavored x402 v1 EIP-3009 authorization; vanilla x402 clients are not compatible). Same content and params as /api/d2a/briefing.",
        params: {
          principal: "(optional) IC principal — returns that contributor's FULL briefing (content, sourceUrl, reason, full scores). Omitted → global ranked INDEX (topItems: title/sourceUrl/topics/score/verdict; sourceUrl redacted under preview); take principals from contributors[].principal",
          since: "(optional) ISO 8601 — exclude briefings generated before this timestamp",
          limit: "(optional) max items to return (default 50, max 100; global path: default 5, max 10)",
          offset: "(optional) pagination offset (default 0)",
          topics: "(optional) comma-separated topic filter (case-insensitive, OR logic)",
          preview: "(optional) 'true' to get truncated content without payment (requires X402_FREE_TIER_ENABLED)",
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
      currency: CURRENCY,
      // The settlement asset the 402 payment requirements will demand on this
      // network. null when the network has no default asset in @x402/evm.
      asset: DEFAULT_ASSET
        ? { address: DEFAULT_ASSET.address, name: DEFAULT_ASSET.name, decimals: DEFAULT_ASSET.decimals }
        : null,
      // Deprecated alias of asset.address — the key predates non-USDC networks.
      usdcContract: DEFAULT_ASSET?.address ?? "unknown",
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
      x402Version: 2,
      // OpenPay-gated endpoints speak x402 v1 (OpenPay-flavored); everything else v2.
      x402V1Endpoints: ["/api/d2a/briefing-jpyc"],
    },
  });
  res.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
  return withCors(res, request.headers.get("origin"));
}

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
