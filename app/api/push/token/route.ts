import { NextRequest, NextResponse } from "next/server";
import { Principal } from "@dfinity/principal";
import * as Sentry from "@sentry/nextjs";
import { distributedRateLimit, parseJsonBody } from "@/lib/api/rateLimit";
import { generatePushToken, isAllowedPushEndpoint } from "@/lib/api/pushToken";
import { createServerControllerActorAsync } from "@/lib/ic/actor.server";
import { errMsg } from "@/lib/utils/errors";

// Budget covers: server identity load (~50ms), HttpAgent syncTime (~500ms),
// getPushSubscriptions canister query (~500ms warm / up to several seconds
// on cold replica), plus HMAC. 15s leaves headroom for IC tail latency
// without holding the function for the Vercel default 300s.
export const maxDuration = 15;

const MAX_ENDPOINTS = 5;

export async function POST(request: NextRequest) {
  const limited = await distributedRateLimit(request, 10, 60);
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
  let principalObj: Principal;
  try {
    principalObj = Principal.fromText(body.principal);
  } catch {
    return NextResponse.json({ error: "principal not a valid Principal text" }, { status: 400 });
  }

  if (!Array.isArray(body.endpoints) || body.endpoints.length === 0) {
    return NextResponse.json({ error: "endpoints required (non-empty array)" }, { status: 400 });
  }
  if (body.endpoints.length > MAX_ENDPOINTS) {
    return NextResponse.json({ error: `endpoints exceeds limit of ${MAX_ENDPOINTS}` }, { status: 400 });
  }
  const requestedEndpoints: string[] = [];
  for (const ep of body.endpoints) {
    if (typeof ep !== "string" || !isAllowedPushEndpoint(ep)) {
      return NextResponse.json({ error: "endpoint not from a recognised Web Push service" }, { status: 400 });
    }
    requestedEndpoints.push(ep);
  }

  // Verify the caller-supplied (principal, endpoints) tuple matches the canister
  // record. Without this check, an attacker can mint a token for any principal
  // and any allowlisted endpoint they control, turning /api/push/send into a
  // relay. The server uses a controller identity (PUSH_SERVER_PRIVATE_KEY) to
  // read getPushSubscriptions for any user — the canister gates that query to
  // caller==user or caller==controller.
  let actor: Awaited<ReturnType<typeof createServerControllerActorAsync>>;
  try {
    actor = await createServerControllerActorAsync();
  } catch (err) {
    console.error("[push/token] Server identity unavailable:", errMsg(err));
    Sentry.captureException(err, { tags: { route: "push-token", failure: "server-identity" } });
    return NextResponse.json({ error: "Push token verification unavailable" }, { status: 503 });
  }

  let registered: Awaited<ReturnType<typeof actor.getPushSubscriptions>>;
  try {
    registered = await actor.getPushSubscriptions(principalObj);
  } catch (err) {
    console.error("[push/token] getPushSubscriptions failed for", body.principal, errMsg(err));
    Sentry.captureException(err, {
      tags: { route: "push-token", failure: "canister-read" },
      extra: { principal: body.principal },
    });
    return NextResponse.json({ error: "Unable to verify subscription ownership" }, { status: 502 });
  }

  const registeredSet = new Set(registered.map((s) => s.endpoint));
  for (const ep of requestedEndpoints) {
    if (!registeredSet.has(ep)) {
      return NextResponse.json(
        { error: "endpoint not registered for principal" },
        { status: 403 },
      );
    }
  }

  return NextResponse.json({ token: generatePushToken(body.principal, requestedEndpoints) });
}
