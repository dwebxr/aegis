import { NextRequest, NextResponse } from "next/server";
import { rateLimit, parseJsonBody } from "@/lib/api/rateLimit";
import { generatePushToken } from "@/lib/api/pushToken";

const MAX_ENDPOINTS = 5;

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 10, 60_000);
  if (limited) return limited;

  if (!process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: "Push not configured" }, { status: 503 });
  }

  const parsed = await parseJsonBody<{ principal?: string; endpoints?: unknown }>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  if (!body.principal || typeof body.principal !== "string") {
    return NextResponse.json({ error: "principal required" }, { status: 400 });
  }

  if (!Array.isArray(body.endpoints) || body.endpoints.length === 0) {
    return NextResponse.json({ error: "endpoints required (non-empty array)" }, { status: 400 });
  }
  if (body.endpoints.length > MAX_ENDPOINTS) {
    return NextResponse.json({ error: `endpoints exceeds limit of ${MAX_ENDPOINTS}` }, { status: 400 });
  }
  for (const ep of body.endpoints) {
    if (typeof ep !== "string" || !ep.startsWith("https://")) {
      return NextResponse.json({ error: "endpoints must be https URLs" }, { status: 400 });
    }
  }

  return NextResponse.json({ token: generatePushToken(body.principal, body.endpoints as string[]) });
}
