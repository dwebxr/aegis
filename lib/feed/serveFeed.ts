import { NextRequest, NextResponse } from "next/server";
import { Principal } from "@dfinity/principal";
import * as Sentry from "@/lib/observability";
import { distributedRateLimit, distributedRateLimitByKey } from "@/lib/api/rateLimit";
import { getLatestBriefing } from "@/lib/d2a/briefingProvider";
import { buildFeed } from "./buildFeed";
import { APP_URL } from "@/lib/config";
import { errMsg } from "@/lib/utils/errors";

// The briefing behind this feed is regenerated at most daily, so a 15-minute
// shared window costs no freshness a reader can perceive and collapses every
// poller onto one function invocation per window.
const CACHE_HEADER = "public, max-age=300, s-maxage=900, stale-while-revalidate=600";
// A malformed request is answered the same way forever, so let the edge own it
// rather than waking a function for each repeat.
const BAD_REQUEST_CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";
// "No briefing yet" flips to a real feed as soon as one is published — short
// enough that a new publisher's feed appears promptly.
const NOT_FOUND_CACHE = "public, s-maxage=300";
// Upstream trouble: cache just enough to blunt a retry storm, not so long that
// recovery is invisible.
const UPSTREAM_ERROR_CACHE = "public, s-maxage=30";

function jsonError(error: string, status: number, cacheControl: string): NextResponse {
  const response = NextResponse.json({ error }, { status });
  response.headers.set("Cache-Control", cacheControl);
  return response;
}

type FeedFormat = "rss" | "atom";

const SERIALIZERS: Record<FeedFormat, { contentType: string; serialize: (f: ReturnType<typeof buildFeed>) => string }> = {
  rss: { contentType: "application/rss+xml; charset=utf-8", serialize: f => f.rss2() },
  atom: { contentType: "application/atom+xml; charset=utf-8", serialize: f => f.atom1() },
};

function selfLinks(principal: string): { rss: string; atom: string } {
  const p = encodeURIComponent(principal);
  return {
    rss: `${APP_URL}/api/feed/rss?principal=${p}`,
    atom: `${APP_URL}/api/feed/atom?principal=${p}`,
  };
}

/**
 * Shared handler for /api/feed/{rss,atom}. Both endpoints serve the same
 * briefing in different envelopes; only the serializer + Content-Type differ.
 */
export async function serveFeed(request: NextRequest, format: FeedFormat): Promise<NextResponse> {
  const principal = request.nextUrl.searchParams.get("principal");
  if (!principal) {
    // Answered before the rate limiter on purpose: this reply depends on
    // nothing, is byte-identical for every caller, and has a single cache key,
    // so the KV round trip the limiter would spend counting it is the only cost
    // in the path. Everything below — which does vary by caller-supplied input
    // — stays behind the limiter.
    return jsonError("Missing required `principal` query parameter", 400, BAD_REQUEST_CACHE);
  }

  const limited = await distributedRateLimit(request, 30, 60);
  if (limited) return limited;

  try {
    Principal.fromText(principal);
  } catch {
    return jsonError("Invalid principal format", 400, BAD_REQUEST_CACHE);
  }

  // Per-principal cap: 60/hour (≈ once a minute). Stops IP-rotating attackers
  // from hammering the IC canister with many distinct principals.
  const principalLimited = await distributedRateLimitByKey(
    `feed:${principal}`,
    60,
    3600,
    "Too many requests for this principal. Try again later.",
  );
  if (principalLimited) return principalLimited;

  let briefing;
  try {
    briefing = await getLatestBriefing(principal);
  } catch (err) {
    console.error(`[feed/${format}] IC briefing fetch failed for ${principal}:`, errMsg(err));
    Sentry.captureException(err, {
      tags: { route: `feed-${format}`, failure: "ic-fetch" },
      extra: { principal },
    });
    return jsonError("Briefing source temporarily unavailable", 502, UPSTREAM_ERROR_CACHE);
  }
  if (!briefing) {
    return jsonError("No briefing available for this principal", 404, NOT_FOUND_CACHE);
  }

  // The briefing is fully identified by when it was generated and how many
  // items it carries, so a conditional request can be answered here, skipping
  // buildFeed + serialisation and the response body. It does NOT skip the IC
  // read above — that is the more expensive half, and the validator is derived
  // from what it returns. Weak: the bytes may differ across deployments
  // (self-links carry APP_URL) while the content they describe is the same.
  const etag = `W/"${briefing.generatedAt}-${briefing.items.length}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Last-Modified": new Date(briefing.generatedAt).toUTCString(),
        "Cache-Control": CACHE_HEADER,
      },
    });
  }

  // Per-item shape is not validated by briefingProvider — defend against a
  // malformed item (missing scores.composite, title, content) crashing the
  // serializer with no Sentry context.
  const links = selfLinks(principal);
  let xml: string;
  try {
    const feed = buildFeed({ briefing, principal, rssSelfUrl: links.rss, atomSelfUrl: links.atom });
    xml = SERIALIZERS[format].serialize(feed);
  } catch (err) {
    console.error(`[feed/${format}] feed serialization failed for ${principal}:`, errMsg(err));
    Sentry.captureException(err, {
      tags: { route: `feed-${format}`, failure: "serialize" },
      extra: { principal, itemCount: briefing.items.length },
    });
    return jsonError("Briefing data is malformed and cannot be rendered", 502, UPSTREAM_ERROR_CACHE);
  }

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": SERIALIZERS[format].contentType,
      "Cache-Control": CACHE_HEADER,
      ETag: etag,
      "Last-Modified": new Date(briefing.generatedAt).toUTCString(),
      "X-Aegis-Briefing-Items": String(briefing.items.length),
      "X-Aegis-Generated-At": briefing.generatedAt,
    },
  });
}
