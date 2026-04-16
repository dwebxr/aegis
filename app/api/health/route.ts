import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { getCanisterId } from "@/lib/ic/config";
import { checkCanisterCycles, checkIcCanisterReachable, getDeployMeta } from "@/lib/ic/health";
import { getFlagSnapshot } from "@/lib/featureFlags";

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

  // Cycles balance probe (cached 60s in-process). "low" = below 2T threshold:
  // the canister self-tops-up from revenue but if revenue is zero it will
  // eventually freeze, so operators must be paged.
  const cycles = checks.icCanister === "reachable"
    ? await checkCanisterCycles("[health]")
    : { status: "error" as const, error: "skipped (canister unreachable)" };
  checks.canisterCycles = cycles.status;

  const allOk = checks.anthropicKey === "configured"
    && checks.icCanister === "reachable"
    && cycles.status === "ok";

  const warnings: string[] = [];
  if (checks.sentryDsn === "missing") warnings.push("error tracking disabled — configure SENTRY_DSN");
  if (checks.kvStore.startsWith("missing")) warnings.push("rate limiting is per-instance only — configure KV_REST_API_URL");
  if (cycles.status === "low") warnings.push(`canister cycles below 2T threshold (balance=${cycles.balance})`);

  const deploy = getDeployMeta();
  const response = NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      ...(warnings.length > 0 && { warnings }),
      timestamp: new Date().toISOString(),
      version: deploy.version,
      node: process.version,
      region: deploy.region,
      checks,
      publicRoutes: [
        "/api/feed/rss",
        "/api/feed/atom",
        "/api-docs",
        "/openapi.yaml",
      ],
      flags: getFlagSnapshot(),
    },
    // 503 on degraded so uptime monitors alert on HTTP status alone.
    { status: allOk ? 200 : 503 },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
