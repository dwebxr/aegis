import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { getCanisterId, getHost } from "@/lib/ic/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const checks: Record<string, string> = {};

  checks.anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() ? "configured" : "missing";

  const canisterId = getCanisterId();
  checks.canisterId = canisterId;

  // Verify IC canister is reachable (lightweight status query)
  const icHost = getHost();
  try {
    const icRes = await fetch(`${icHost}/api/v2/canister/${canisterId}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/cbor" },
      body: new Uint8Array(0),
      signal: AbortSignal.timeout(5000),
    });
    // 400 = canister reachable but bad request (expected with empty body)
    // 200 = canister reachable
    checks.icCanister = icRes.status === 400 || icRes.ok ? "reachable" : `error (${icRes.status})`;
  } catch {
    checks.icCanister = "unreachable";
  }

  const allOk = checks.anthropicKey === "configured" && checks.icCanister === "reachable";

  return NextResponse.json({
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    node: process.version,
    region: (process.env.VERCEL_REGION || "local").trim(),
    checks,
  });
}
