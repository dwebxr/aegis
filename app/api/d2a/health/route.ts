import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import { X402_RECEIVER, X402_NETWORK } from "@/lib/d2a/x402Server";
import { getCanisterId, getHost } from "@/lib/ic/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const checks: Record<string, string> = {};

  checks.x402Receiver = X402_RECEIVER ? "configured" : "not configured";
  checks.x402Network = X402_NETWORK;

  const icHost = getHost();
  const canisterId = getCanisterId();
  try {
    const icRes = await fetch(`${icHost}/api/v2/canister/${canisterId}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/cbor" },
      body: new Uint8Array(0),
      signal: AbortSignal.timeout(5000),
    });
    checks.icCanister = icRes.status === 400 || icRes.ok ? "reachable" : `error (${icRes.status})`;
  } catch {
    checks.icCanister = "unreachable";
  }

  const allOk = checks.icCanister === "reachable" && checks.x402Receiver !== "not configured";

  const response = NextResponse.json({
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    region: (process.env.VERCEL_REGION || "local").trim(),
    checks,
  });

  return withCors(response, request.headers.get("origin"));
}

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
