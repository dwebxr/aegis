import { createHmac } from "crypto";

// Real Web Push services. Restricting endpoints to these hosts prevents using
// /api/push/send as an arbitrary-HTTPS relay even if an attacker mints a
// token for a victim principal with attacker-controlled endpoints.
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
];
const PUSH_SERVICE_HOST_SUFFIXES = [
  ".notify.windows.com",
  ".push.apple.com",
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (PUSH_SERVICE_HOSTS.includes(host)) return true;
  return PUSH_SERVICE_HOST_SUFFIXES.some(s => host.endsWith(s));
}

/**
 * HMAC-SHA256 token binding a push request to the exact (principal, endpoints)
 * tuple it will deliver to. The VAPID private key seeds the HMAC.
 *
 * Endpoints are lowercased + sorted before hashing so token equality does not
 * depend on caller-provided ordering. An attacker cannot expand the scope of a
 * captured token by adding endpoints, because the HMAC would no longer match.
 *
 * /api/push/token verifies the (principal, endpoints) tuple against the
 * canister's recorded subscriptions BEFORE minting — server uses a
 * controller identity (PUSH_SERVER_PRIVATE_KEY) to read getPushSubscriptions
 * for the target principal, which the canister gates to caller==user or
 * caller==controller. Only endpoints the user actually registered survive
 * the check. isAllowedPushEndpoint further restricts to known Web Push
 * services as defence in depth.
 *
 * NUL separator follows the `itemHash` pattern in lib/d2a/filterItems.ts so
 * that field boundaries can't collide with valid input.
 */
export function generatePushToken(principal: string, endpoints: string[] = []): string {
  const secret = process.env.VAPID_PRIVATE_KEY || "";
  const canonical = [...endpoints].map(e => e.toLowerCase()).sort().join("\0");
  const message = `${principal}\0${canonical}`;
  return createHmac("sha256", secret).update(message).digest("hex").slice(0, 32);
}
