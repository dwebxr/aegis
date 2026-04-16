import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import { X402_RECEIVER, X402_NETWORK } from "@/lib/d2a/x402Server";
import { checkIcCanisterReachable, getDeployMeta } from "@/lib/ic/health";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const checks: Record<string, string> = {};

  checks.x402Receiver = X402_RECEIVER ? "configured" : "not configured";
  checks.x402Network = X402_NETWORK;

  checks.icCanister = await checkIcCanisterReachable("[d2a/health]");

  const allOk = checks.icCanister === "reachable" && checks.x402Receiver !== "not configured";

  const deploy = getDeployMeta();
  const response = NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      version: deploy.version,
      region: deploy.region,
      checks,
    },
    { status: allOk ? 200 : 503 },
  );

  response.headers.set("Cache-Control", "no-store");
  return withCors(response, request.headers.get("origin"));
}

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
