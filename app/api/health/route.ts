import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};

  checks.anthropicKey = process.env.ANTHROPIC_API_KEY ? "configured" : "missing";

  const canisterId = (process.env.NEXT_PUBLIC_CANISTER_ID || "").trim();
  checks.canisterId = canisterId ? canisterId : "missing (using default)";

  const allOk = checks.anthropicKey === "configured";

  return NextResponse.json({
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    node: process.version,
    region: process.env.VERCEL_REGION || "local",
    checks,
  });
}
