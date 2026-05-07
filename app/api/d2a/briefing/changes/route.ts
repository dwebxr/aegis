import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { withX402 } from "@x402/next";
import { rateLimit } from "@/lib/api/rateLimit";
import { errMsg } from "@/lib/utils/errors";
import { getRawGlobalBriefings } from "@/lib/d2a/briefingProvider";
import { resourceServer, X402_NETWORK, X402_PRICE, X402_RECEIVER } from "@/lib/d2a/x402Server";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import { itemHash } from "@/lib/d2a/filterItems";
import { isFeatureEnabled } from "@/lib/featureFlags";
import type { BriefingChange, ChangesResponse } from "@/lib/d2a/types";

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
  description: "Aegis briefing change feed — diffs since a given timestamp",
};

async function handleGet(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const origin = request.headers.get("origin");
  const sinceParam = request.nextUrl.searchParams.get("since");
  const preview = X402_FREE_TIER && request.nextUrl.searchParams.get("preview") === "true";

  if (!sinceParam) {
    return withCors(
      NextResponse.json({ error: "Missing required parameter: since" }, { status: 400 }),
      origin,
    );
  }

  const sinceDate = new Date(sinceParam);
  if (isNaN(sinceDate.getTime())) {
    return withCors(
      NextResponse.json({ error: "Invalid since parameter: must be ISO 8601" }, { status: 400 }),
      origin,
    );
  }

  try {
    const entries = await getRawGlobalBriefings(sinceDate.getTime());

    const changes: BriefingChange[] = [];
    for (const { briefing, generatedAtMs } of entries) {
      const generatedAt = new Date(generatedAtMs).toISOString();
      for (const item of briefing.items) {
        const hash = itemHash(item.title, item.sourceUrl);
        // Preview mode redacts title/sourceUrl: callers learn that something
        // changed and what its rank is, but not which article it actually is.
        // Full title/URL is only behind the x402 paywall (matches /api/d2a/briefing).
        changes.push({
          action: "added",
          itemHash: hash,
          title: preview ? "" : item.title,
          sourceUrl: preview ? "" : item.sourceUrl,
          composite: item.scores?.composite ?? 0,
          generatedAt,
        });
      }
    }

    const response: ChangesResponse = {
      since: sinceDate.toISOString(),
      checkedAt: new Date().toISOString(),
      changes,
    };

    return withCors(NextResponse.json(response), origin);
  } catch (error) {
    console.error("[d2a/briefing/changes] Error:", errMsg(error));
    Sentry.captureException(error, { tags: { route: "d2a-briefing-changes", failure: "fetch" } });
    return withCors(
      NextResponse.json({ error: "Failed to fetch changes" }, { status: 500 }),
      origin,
    );
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
