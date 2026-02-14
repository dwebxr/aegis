import { NextRequest, NextResponse } from "next/server";
import { TwitterApi } from "twitter-api-v2";
import { rateLimit } from "@/lib/api/rateLimit";
import { errMsg } from "@/lib/utils/errors";
import { withTimeout } from "@/lib/utils/timeout";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }
  const { bearerToken, query, maxResults = 10 } = body;

  if (!bearerToken || typeof bearerToken !== "string" || bearerToken.trim().length === 0) {
    return NextResponse.json({ error: "Bearer token is required" }, { status: 400 });
  }

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "Search query is required" }, { status: 400 });
  }

  const client = new TwitterApi(bearerToken);
  const readOnlyClient = client.readOnly;

  let result;
  try {
    result = await withTimeout(readOnlyClient.v2.search(query, {
      max_results: Math.min(Math.max(maxResults, 10), 100),
      "tweet.fields": ["created_at", "author_id"],
      expansions: ["author_id"],
      "user.fields": ["name", "username"],
    }), 15_000, "X API request timed out");
  } catch (err: unknown) {
    console.error("[fetch/twitter] X API error:", err);
    const msg = errMsg(err);
    if (msg.includes("401") || msg.includes("Unauthorized")) {
      return NextResponse.json({ error: "Invalid or expired X API bearer token. Please check your token." }, { status: 401 });
    }
    if (msg.includes("429") || msg.includes("Rate limit")) {
      return NextResponse.json({ error: "X API rate limit reached. Try again later." }, { status: 429 });
    }
    if (msg.includes("403") || msg.includes("Forbidden")) {
      return NextResponse.json({ error: "Your X API access level doesn't include search. You need Basic tier ($200/mo) or higher." }, { status: 403 });
    }
    return NextResponse.json({ error: "X API request failed. Please try again later." }, { status: 500 });
  }

  const users = new Map<string, { name: string; username: string }>();
  if (result.includes?.users) {
    for (const user of result.includes.users) {
      users.set(user.id, { name: user.name, username: user.username });
    }
  }

  const tweets = (result.data?.data || []).map(tweet => {
    const user = users.get(tweet.author_id || "");
    return {
      id: tweet.id,
      text: tweet.text,
      author: user?.name || "Unknown",
      authorHandle: user ? `@${user.username}` : "@unknown",
      createdAt: tweet.created_at || "",
    };
  });

  return NextResponse.json({ tweets });
}
