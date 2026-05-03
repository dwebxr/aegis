import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import webpush from "web-push";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "@/lib/ic/declarations/idlFactory";
import { rateLimit, checkBodySize, parseJsonBody } from "@/lib/api/rateLimit";
import { generatePushToken } from "@/lib/api/pushToken";
import { errMsg } from "@/lib/utils/errors";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { getCanisterId, getHost } from "@/lib/ic/config";
import type { _SERVICE, PushSubscription } from "@/lib/ic/declarations/aegis_backend.did";

export const maxDuration = 30;

if (process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
  webpush.setVapidDetails(
    (process.env.VAPID_SUBJECT || "mailto:admin@dwebxr.xyz").trim(),
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY.trim(),
    process.env.VAPID_PRIVATE_KEY.trim(),
  );
}

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("pushSend")) {
    return NextResponse.json({ error: "Push delivery disabled" }, { status: 503 });
  }

  const limited = rateLimit(request, 5, 60_000);
  if (limited) return limited;
  const tooLarge = checkBodySize(request);
  if (tooLarge) return tooLarge;

  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    return NextResponse.json({ error: "Push not configured" }, { status: 503 });
  }

  const parsed = await parseJsonBody<{ principal?: string; token?: string; title?: string; body?: string; url?: string; tag?: string }>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  if (!body.principal) {
    return NextResponse.json({ error: "principal required" }, { status: 400 });
  }

  // Verify caller authorization via HMAC token
  const expected = generatePushToken(body.principal);
  if (!body.token || body.token !== expected) {
    return NextResponse.json({ error: "Invalid or missing push token" }, { status: 403 });
  }

  let userPrincipal: Principal;
  try {
    userPrincipal = Principal.fromText(body.principal);
  } catch {
    return NextResponse.json({ error: "Invalid principal" }, { status: 400 });
  }

  try {
    const agent = await HttpAgent.create({ host: getHost() });
    const actor = Actor.createActor<_SERVICE>(idlFactory, {
      agent,
      canisterId: getCanisterId(),
    });

    const subscriptions = await actor.getPushSubscriptions(userPrincipal);
    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ sent: 0, message: "No subscriptions" });
    }

    const payload = JSON.stringify({
      title: body.title || "Aegis Briefing",
      body: body.body || "Your new briefing is ready.",
      url: body.url || "/",
      tag: body.tag || "aegis-briefing",
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub: PushSubscription) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          payload,
        ),
      ),
    );

    const expiredEndpoints: string[] = [];
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        const statusCode = (result.reason as { statusCode?: number })?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          expiredEndpoints.push(subscriptions[i].endpoint);
        }
      }
    });

    let cleanupFailed = false;
    if (expiredEndpoints.length > 0) {
      try {
        await actor.removePushSubscriptions(userPrincipal, expiredEndpoints);
      } catch (e) {
        cleanupFailed = true;
        console.error("[push] Failed to remove expired subscriptions for %s (%d endpoints):", body.principal, expiredEndpoints.length, errMsg(e));
      }
    }

    const sent = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    return NextResponse.json({ sent, failed, expired: expiredEndpoints.length, cleanupFailed });
  } catch (error) {
    console.error("[push] Send error:", errMsg(error));
    Sentry.captureException(error, {
      tags: { route: "push-send", failure: "send" },
    });
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
