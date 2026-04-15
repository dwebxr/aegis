import { NextRequest, NextResponse } from "next/server";
import { serveFeed } from "@/lib/feed/serveFeed";

export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  return serveFeed(request, "rss");
}
