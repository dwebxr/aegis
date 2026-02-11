import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const checks: Record<string, string> = {};

  checks.anthropicKey = process.env.ANTHROPIC_API_KEY ? "configured" : "missing";

  const canisterId = (process.env.NEXT_PUBLIC_CANISTER_ID || "").trim();
  checks.canisterId = canisterId ? canisterId : "missing (using default)";

  // Verify IC canister is reachable (lightweight status query)
  const icHost = (process.env.NEXT_PUBLIC_IC_HOST || "https://icp-api.io").trim();
  const effectiveCanisterId = canisterId || "rluf3-eiaaa-aaaam-qgjuq-cai";
  try {
    const icRes = await fetch(`${icHost}/api/v2/canister/${effectiveCanisterId}/query`, {
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
    region: process.env.VERCEL_REGION || "local",
    checks,
  });
}
