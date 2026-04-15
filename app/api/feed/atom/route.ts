import { NextRequest, NextResponse } from "next/server";
import { Principal } from "@dfinity/principal";
import { distributedRateLimit } from "@/lib/api/rateLimit";
import { getLatestBriefing } from "@/lib/d2a/briefingProvider";
import { buildFeed } from "@/lib/feed/buildFeed";
import { APP_URL } from "@/lib/config";

export const maxDuration = 30;

const CACHE_HEADER = "public, max-age=300, s-maxage=300, stale-while-revalidate=600";

function selfLinks(principal: string): { rss: string; atom: string } {
  const encoded = encodeURIComponent(principal);
  return {
    rss: `${APP_URL}/api/feed/rss?principal=${encoded}`,
    atom: `${APP_URL}/api/feed/atom?principal=${encoded}`,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
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

  const briefing = await getLatestBriefing(principal);
  if (!briefing) {
    return NextResponse.json(
      { error: "No briefing available for this principal" },
      { status: 404 },
    );
  }

  const { rss, atom } = selfLinks(principal);
  const feed = buildFeed({ briefing, principal, rssSelfUrl: rss, atomSelfUrl: atom });
  const xml = feed.atom1();

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": CACHE_HEADER,
      "X-Aegis-Briefing-Items": String(briefing.items.length),
      "X-Aegis-Generated-At": briefing.generatedAt,
    },
  });
}
