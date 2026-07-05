import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { Principal } from "@dfinity/principal";
import { errMsg } from "@/lib/utils/errors";
import { getLatestBriefing, getGlobalBriefingSummaries } from "@/lib/d2a/briefingProvider";
import { withCors } from "@/lib/d2a/cors";
import { parseFilterParams, filterAndPaginate, applyPreview } from "@/lib/d2a/filterItems";
import { isFeatureEnabled } from "@/lib/featureFlags";

const X402_FREE_TIER = isFeatureEnabled("x402FreeTier");

/** Briefing content generation shared by /api/d2a/briefing (x402 v2, USDC on Base)
 *  and /api/d2a/briefing-jpyc (OpenPay x402 v1, JPYC on Polygon).
 *
 *  Extracted verbatim from the briefing route's handleGet MINUS the rate-limit
 *  call — each route rate-limits before its own payment gate so unauthenticated
 *  traffic can't drive facilitator calls. Behavior is otherwise unchanged and
 *  locked in by the pre-existing briefing route tests. */
export async function buildBriefingResponse(request: NextRequest): Promise<NextResponse> {
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

    // Global aggregation path — gated by the briefingAggregation kill switch.
    // Per-principal briefings above remain available regardless.
    if (!isFeatureEnabled("briefingAggregation")) {
      return withCors(
        NextResponse.json({ error: "Global briefing aggregation disabled" }, { status: 503 }),
        origin,
      );
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
    const rawGlobal = hasFilters
      ? await getGlobalBriefingSummaries(0, 100)
      : await getGlobalBriefingSummaries(offset, limit);
    if (!rawGlobal) {
      return withCors(
        NextResponse.json({ error: "No global briefings available" }, { status: 404 }),
        origin,
      );
    }

    // Preview (free tier) redacts topItems URLs — same semantics as /changes:
    // callers learn what ranks where, but which article it is stays paid.
    const global = preview
      ? {
          ...rawGlobal,
          contributors: rawGlobal.contributors.map(c => ({
            ...c,
            topItems: c.topItems.map(t => ({ ...t, sourceUrl: "" })),
          })),
        }
      : rawGlobal;

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
    Sentry.captureException(error, { tags: { route: "d2a-briefing", failure: "fetch" } });
    return withCors(NextResponse.json({ error: "Failed to fetch briefing" }, { status: 500 }), origin);
  }
}
