import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { getCanisterId, getHost } from "@/lib/ic/config";
import { errMsg } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const checks: Record<string, string> = {};

  checks.anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() ? "configured" : "missing";
  // Mirror sentry.server.config.ts: server-only SENTRY_DSN takes precedence over public var
  const sentryDsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  checks.sentryDsn = sentryDsn ? "configured" : "missing";
  checks.kvStore = process.env.KV_REST_API_URL?.trim() ? "configured" : "missing (budget per-instance)";

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
  } catch (err) {
    checks.icCanister = "unreachable";
    console.warn("[health] IC canister check failed:", errMsg(err));
  }

  // "ok" requires only services that make the app non-functional when absent.
  // Sentry and KV are advisory: the app works without them.
  const allOk = checks.anthropicKey === "configured" && checks.icCanister === "reachable";

  const warnings: string[] = [];
  if (checks.sentryDsn === "missing") warnings.push("error tracking disabled — configure SENTRY_DSN");
  if (checks.kvStore.startsWith("missing")) warnings.push("rate limiting is per-instance only — configure KV_REST_API_URL");

  const response = NextResponse.json({
    status: allOk ? "ok" : "degraded",
    ...(warnings.length > 0 && { warnings }),
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    node: process.version,
    region: (process.env.VERCEL_REGION || "local").trim(),
    checks,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
