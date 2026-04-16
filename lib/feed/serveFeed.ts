import { NextRequest, NextResponse } from "next/server";
import { Principal } from "@dfinity/principal";
import * as Sentry from "@sentry/nextjs";
import { distributedRateLimit, distributedRateLimitByKey } from "@/lib/api/rateLimit";
import { getLatestBriefing } from "@/lib/d2a/briefingProvider";
import { buildFeed } from "./buildFeed";
import { APP_URL } from "@/lib/config";
import { errMsg } from "@/lib/utils/errors";

const CACHE_HEADER = "public, max-age=300, s-maxage=300, stale-while-revalidate=600";

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
  const limited = await distributedRateLimit(request, 30, 60);
  if (limited) return limited;

  const principal = request.nextUrl.searchParams.get("principal");
  if (!principal) {
    return NextResponse.json(
      { error: "Missing required `principal` query parameter" },
      { status: 400 },
    );
  }

  try {
    Principal.fromText(principal);
  } catch {
    return NextResponse.json({ error: "Invalid principal format" }, { status: 400 });
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
    return NextResponse.json(
      { error: "Briefing source temporarily unavailable" },
      { status: 502 },
    );
  }
  if (!briefing) {
    return NextResponse.json(
      { error: "No briefing available for this principal" },
      { status: 404 },
    );
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
    return NextResponse.json(
      { error: "Briefing data is malformed and cannot be rendered" },
      { status: 502 },
    );
  }

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": SERIALIZERS[format].contentType,
      "Cache-Control": CACHE_HEADER,
      "X-Aegis-Briefing-Items": String(briefing.items.length),
      "X-Aegis-Generated-At": briefing.generatedAt,
    },
  });
}
