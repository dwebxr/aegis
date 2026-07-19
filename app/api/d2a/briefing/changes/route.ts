import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { withX402 } from "@x402/next";
import { distributedRateLimit } from "@/lib/api/rateLimit";
import { BRIEFING_CHANGES_BAZAAR_METADATA } from "@/lib/d2a/bazaar";
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
  ...BRIEFING_CHANGES_BAZAAR_METADATA,
};

async function handleGet(request: NextRequest): Promise<NextResponse> {
  const limited = await distributedRateLimit(request, 30, 60);
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

// Receiver configured → x402 paywall; receiver unset → served free. Free-when-unset
// is INTENTIONAL (this deployment runs the briefing free). Do not "harden" to 503.
type ChangesHandler = (request: NextRequest) => Promise<NextResponse>;
let paidHandler: ChangesHandler | null = null;

function getPaidHandler(): ChangesHandler {
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

// Never cache: a diff feed of paid/principal-specific briefings must not leak via CDN.
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
