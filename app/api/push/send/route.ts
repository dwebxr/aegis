import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { HttpAgent, Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "@/lib/ic/declarations/idlFactory";
import { rateLimit } from "@/lib/api/rateLimit";
import { errMsg } from "@/lib/utils/errors";
import { getCanisterId, getHost } from "@/lib/ic/agent";
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
  const limited = rateLimit(request, 5, 60_000);
  if (limited) return limited;

  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    return NextResponse.json({ error: "Push not configured" }, { status: 503 });
  }

  let body: { principal?: string; title?: string; body?: string; url?: string; tag?: string };
  try {
    body = await request.json();
  } catch (err) {
    console.warn("[push/send] JSON parse failed:", errMsg(err));
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.principal) {
    return NextResponse.json({ error: "principal required" }, { status: 400 });
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
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
