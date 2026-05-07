import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import webpush from "web-push";
import { Principal } from "@dfinity/principal";
import { rateLimit, checkBodySize, parseJsonBody } from "@/lib/api/rateLimit";
import { generatePushToken } from "@/lib/api/pushToken";
import { errMsg } from "@/lib/utils/errors";
import { isFeatureEnabled } from "@/lib/featureFlags";

export const maxDuration = 30;

if (process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
  webpush.setVapidDetails(
    (process.env.VAPID_SUBJECT || "mailto:admin@dwebxr.xyz").trim(),
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY.trim(),
    process.env.VAPID_PRIVATE_KEY.trim(),
  );
}

interface InputSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const MAX_SUBSCRIPTIONS = 5;

function isValidSubscription(s: unknown): s is InputSubscription {
  if (!s || typeof s !== "object") return false;
  const sub = s as Record<string, unknown>;
  if (typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://")) return false;
  const keys = sub.keys as Record<string, unknown> | undefined;
  if (!keys || typeof keys !== "object") return false;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
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

  const parsed = await parseJsonBody<{
    principal?: string;
    subscriptions?: unknown;
    token?: string;
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
  }>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  if (!body.principal) {
    return NextResponse.json({ error: "principal required" }, { status: 400 });
  }

  if (!Array.isArray(body.subscriptions) || body.subscriptions.length === 0) {
    return NextResponse.json({ error: "subscriptions required (non-empty array)" }, { status: 400 });
  }
  if (body.subscriptions.length > MAX_SUBSCRIPTIONS) {
    return NextResponse.json({ error: `subscriptions exceeds limit of ${MAX_SUBSCRIPTIONS}` }, { status: 400 });
  }
  for (const sub of body.subscriptions) {
    if (!isValidSubscription(sub)) {
      return NextResponse.json({ error: "invalid subscription shape" }, { status: 400 });
    }
  }
  const subscriptions = body.subscriptions as InputSubscription[];

  const expected = generatePushToken(body.principal, subscriptions.map(s => s.endpoint));
  if (!body.token || body.token !== expected) {
    return NextResponse.json({ error: "Invalid or missing push token" }, { status: 403 });
  }

  try {
    Principal.fromText(body.principal);
  } catch {
    return NextResponse.json({ error: "Invalid principal" }, { status: 400 });
  }

  try {
    const payload = JSON.stringify({
      title: body.title || "Aegis Briefing",
      body: body.body || "Your new briefing is ready.",
      url: body.url || "/",
      tag: body.tag || "aegis-briefing",
    });

    const results = await Promise.allSettled(
      subscriptions.map(sub =>
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

    const sent = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    // Cleanup of expired endpoints is the client's responsibility: the canister
    // gates getPushSubscriptions/removePushSubscriptions to the caller, and
    // this route runs anonymously. Clients should call
    // unregisterPushSubscription(endpoint) on the auth'd actor for each entry
    // in expiredEndpoints.
    return NextResponse.json({ sent, failed, expiredEndpoints });
  } catch (error) {
    console.error("[push] Send error:", errMsg(error));
    Sentry.captureException(error, {
      tags: { route: "push-send", failure: "send" },
    });
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
