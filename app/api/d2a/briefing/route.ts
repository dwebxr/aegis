import { NextRequest, NextResponse } from "next/server";
import { Principal } from "@dfinity/principal";
import { withX402 } from "@x402/next";
import { rateLimit } from "@/lib/api/rateLimit";
import { errMsg } from "@/lib/utils/errors";
import { getLatestBriefing, getGlobalBriefingSummaries } from "@/lib/d2a/briefingProvider";
import { resourceServer, X402_NETWORK, X402_PRICE, X402_RECEIVER } from "@/lib/d2a/x402Server";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import { parseFilterParams, filterAndPaginate, applyPreview } from "@/lib/d2a/filterItems";

export const maxDuration = 30;

const X402_FREE_TIER = process.env.X402_FREE_TIER_ENABLED === "true";

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
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const origin = request.headers.get("origin");
  const searchParams = request.nextUrl.searchParams;
  const principal = searchParams.get("principal") || undefined;
  const preview = X402_FREE_TIER && searchParams.get("preview") === "true";

  if (principal) {
    try {
      Principal.fromText(principal);
    } catch {
      return withCors(NextResponse.json({ error: "Invalid principal format" }, { status: 400 }), origin);
    }
  }

  try {
    if (principal) {
      const briefing = await getLatestBriefing(principal);
      if (!briefing) {
        return withCors(
          NextResponse.json({ error: "No briefing available" }, { status: 404 }),
          origin,
        );
      }

      const filtered = filterAndPaginate(briefing, parseFilterParams(searchParams));
      const result = preview ? applyPreview(filtered) : filtered;

      return withCors(NextResponse.json(result), origin);
    }

    const parsedOffset = searchParams.get("offset") !== null ? parseInt(searchParams.get("offset")!, 10) : NaN;
    const offset = isNaN(parsedOffset) ? 0 : Math.max(0, parsedOffset);
    const parsedLimit = searchParams.get("limit") !== null ? parseInt(searchParams.get("limit")!, 10) : NaN;
    const limit = isNaN(parsedLimit) ? 5 : Math.min(10, Math.max(1, parsedLimit));

    const sinceRaw = searchParams.get("since");
    const topicsRaw = searchParams.get("topics");
    const hasFilters = !!sinceRaw || !!topicsRaw;

    // When filters are active, fetch a larger batch and filter in-memory
    // because the canister can't filter by since/topics natively
    const global = hasFilters
      ? await getGlobalBriefingSummaries(0, 100)
      : await getGlobalBriefingSummaries(offset, limit);
    if (!global) {
      return withCors(
        NextResponse.json({ error: "No global briefings available" }, { status: 404 }),
        origin,
      );
    }

    if (hasFilters) {
      let filtered = global.contributors;

      if (sinceRaw) {
        const sinceDate = new Date(sinceRaw);
        if (!isNaN(sinceDate.getTime())) {
          const sinceTs = sinceDate.getTime();
          filtered = filtered.filter(c => new Date(c.generatedAt).getTime() >= sinceTs);
        }
      }

      if (topicsRaw) {
        const topicSet = new Set(topicsRaw.split(",").map(t => t.trim().toLowerCase()).filter(Boolean));
        if (topicSet.size > 0) {
          filtered = filtered.filter(c =>
            c.topItems.some(item =>
              item.topics.some(t => topicSet.has(t.toLowerCase())),
            ),
          );
        }
      }

      const total = filtered.length;
      const paged = filtered.slice(offset, offset + limit);

      return withCors(NextResponse.json({
        ...global,
        contributors: paged,
        pagination: { offset, limit, total, hasMore: offset + limit < total },
      }), origin);
    }

    return withCors(NextResponse.json(global), origin);
  } catch (error) {
    console.error("[d2a/briefing] Error:", errMsg(error));
    return withCors(NextResponse.json({ error: "Failed to fetch briefing" }, { status: 500 }), origin);
  }
}

export const GET = X402_RECEIVER
  ? X402_FREE_TIER
    ? async (request: NextRequest) => {
        if (request.nextUrl.searchParams.get("preview") === "true") return handleGet(request);
        return withX402(handleGet, x402Config, resourceServer)(request);
      }
    : withX402(handleGet, x402Config, resourceServer)
  : handleGet;

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
