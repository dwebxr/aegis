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
  // status/version/timestamp stay public so uptime monitors alert on HTTP status
  // alone. The detailed checks/flags (which env vars are set, feature-flag state)
  // are internal config — gate them behind an optional bearer token. When
  // HEALTH_DETAIL_TOKEN is unset, behavior is unchanged (ops tooling keeps working);
  // set it to stop leaking config posture to anonymous callers.
  const detailToken = process.env.HEALTH_DETAIL_TOKEN?.trim();
  const authorization = request.headers.get("authorization");
  const showDetail = !detailToken || authorization === `Bearer ${detailToken}`;
  const body: Record<string, unknown> = {
    status: allOk ? "ok" : "degraded",
    ...(warnings.length > 0 && { warnings }),
    timestamp: new Date().toISOString(),
    version: deploy.version,
  };
  if (showDetail) {
    body.node = process.version;
    body.region = deploy.region;
    body.checks = checks;
    body.publicRoutes = ["/api/feed/rss", "/api/feed/atom", "/api-docs", "/openapi.yaml"];
    body.flags = getFlagSnapshot();
  }
  const response = NextResponse.json(body, { status: allOk ? 200 : 503 });
  // A shared 30s window on healthy responses collapses however often this is
  // polled into at most two function invocations a minute. Three rules keep it
  // from lying:
  //   - only 200s. A 503 is never cached, so a degraded deployment is reported
  //     the moment the next request arrives rather than after the window.
  //   - no stale-while-revalidate. It would let the edge keep serving the last
  //     "ok" after the state changed, defeating monitors that alert on status
  //     alone.
  //   - never when Authorization is present. The body varies by that header
  //     (detailed checks/flags), so a request carrying one is served fresh and
  //     stored nowhere; Vary is belt-and-braces for any intermediary that would
  //     cache it anyway.
  // max-age=0 keeps the browser/monitor itself from reusing a response — only
  // the shared cache gets the window.
  const cacheable = allOk && !authorization;
  response.headers.set(
    "Cache-Control",
    cacheable ? "public, max-age=0, s-maxage=30" : "no-store",
  );
  response.headers.set("Vary", "Authorization");
  return response;
}
