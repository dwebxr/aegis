import { NextRequest, NextResponse } from "next/server";
import { rateLimit, parseJsonBody } from "@/lib/api/rateLimit";
import { generatePushToken } from "@/lib/api/pushToken";

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 10, 60_000);
  if (limited) return limited;

  if (!process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: "Push not configured" }, { status: 503 });
  }

  const parsed = await parseJsonBody<{ principal?: string }>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  if (!body.principal || typeof body.principal !== "string") {
    return NextResponse.json({ error: "principal required" }, { status: 400 });
  }

  return NextResponse.json({ token: generatePushToken(body.principal) });
}
