import { NextRequest, NextResponse } from "next/server";
import { Principal } from "@dfinity/principal";
import { distributedRateLimit } from "@/lib/api/rateLimit";
import { getLatestBriefing } from "@/lib/d2a/briefingProvider";
import { buildFeed } from "./buildFeed";
import { APP_URL } from "@/lib/config";
import { errMsg } from "@/lib/utils/errors";

const CACHE_HEADER = "public, max-age=300, s-maxage=300, stale-while-revalidate=600";

export type FeedFormat = "rss" | "atom";

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

  let briefing;
  try {
    briefing = await getLatestBriefing(principal);
  } catch (err) {
    console.error(`[feed/${format}] IC briefing fetch failed for ${principal}:`, errMsg(err));
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

  const links = selfLinks(principal);
  const feed = buildFeed({ briefing, principal, rssSelfUrl: links.rss, atomSelfUrl: links.atom });
  const { contentType, serialize } = SERIALIZERS[format];

  return new NextResponse(serialize(feed), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": CACHE_HEADER,
      "X-Aegis-Briefing-Items": String(briefing.items.length),
      "X-Aegis-Generated-At": briefing.generatedAt,
    },
  });
}
