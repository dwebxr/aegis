import { NextRequest, NextResponse } from "next/server";
import { distributedGuardAndParse } from "@/lib/api/rateLimit";
import { extractArticle } from "@/lib/extraction/extractArticle.server";

export const maxDuration = 30;

/** Kept in lockstep with MAX_ENRICH_PER_CYCLE in lib/ingestion/scheduler.ts. */
const MAX_BATCH_URLS = 3;

export async function POST(request: NextRequest) {
  const { body, error } = await distributedGuardAndParse<{ url?: string; urls?: string[] }>(request);
  if (error) return error;

  const { url, urls } = body;

  if (urls && Array.isArray(urls)) {
    const validUrls = urls
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      // Every page in a batch is DOM-parsed concurrently at ~85-115ms of CPU
      // each, so the batch size is a direct multiplier on this route's cost.
      // The only caller is the ingestion scheduler, whose MAX_ENRICH_PER_CYCLE
      // is 3 — a cap of 10 bought nothing but headroom for abuse.
      .slice(0, MAX_BATCH_URLS);

    if (validUrls.length === 0) {
      return NextResponse.json({ error: "At least one URL is required" }, { status: 400 });
    }

    const extractions = await Promise.allSettled(validUrls.map(u => extractArticle(u)));
    return NextResponse.json({
      results: extractions.map((r, i) => {
        if (r.status === "fulfilled") {
          const ex = r.value;
          return ex.data
            ? { url: validUrls[i], ...ex.data }
            : { url: validUrls[i], error: ex.error };
        }
        return { url: validUrls[i], error: "Extraction failed" };
      }),
    });
  }

  // Single mode (backward compatible — preserves exact status codes)
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  const result = await extractArticle(url);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
