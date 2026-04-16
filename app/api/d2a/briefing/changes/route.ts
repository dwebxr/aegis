import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { rateLimit } from "@/lib/api/rateLimit";
import { errMsg } from "@/lib/utils/errors";
import { getRawGlobalBriefings } from "@/lib/d2a/briefingProvider";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import { itemHash } from "@/lib/d2a/filterItems";
import type { BriefingChange, ChangesResponse } from "@/lib/d2a/types";

export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const origin = request.headers.get("origin");
  const sinceParam = request.nextUrl.searchParams.get("since");

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
        changes.push({
          action: "added",
          itemHash: itemHash(item.title, item.sourceUrl),
          title: item.title,
          sourceUrl: item.sourceUrl,
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

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
