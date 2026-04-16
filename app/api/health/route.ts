import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { getCanisterId } from "@/lib/ic/config";
import { checkIcCanisterReachable, getDeployMeta } from "@/lib/ic/health";

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

  checks.canisterId = getCanisterId();

  // Verify IC canister is reachable (lightweight status query)
  checks.icCanister = await checkIcCanisterReachable("[health]");

  // "ok" requires only services that make the app non-functional when absent.
  // Sentry and KV are advisory: the app works without them.
  const allOk = checks.anthropicKey === "configured" && checks.icCanister === "reachable";

  const warnings: string[] = [];
  if (checks.sentryDsn === "missing") warnings.push("error tracking disabled — configure SENTRY_DSN");
  if (checks.kvStore.startsWith("missing")) warnings.push("rate limiting is per-instance only — configure KV_REST_API_URL");

  const deploy = getDeployMeta();
  const response = NextResponse.json({
    status: allOk ? "ok" : "degraded",
    ...(warnings.length > 0 && { warnings }),
    timestamp: new Date().toISOString(),
    version: deploy.version,
    node: process.version,
    region: deploy.region,
    checks,
    // Documentation only — these are static routes whose presence is
    // build-time guaranteed by Next.js file-based routing. NOT probed.
    publicRoutes: [
      "/api/feed/rss",
      "/api/feed/atom",
      "/api-docs",
      "/openapi.yaml",
    ],
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
