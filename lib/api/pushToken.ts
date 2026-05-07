import { createHmac } from "crypto";

/**
 * HMAC-SHA256 token binding a push request to the exact (principal, endpoints)
 * tuple it will deliver to. The VAPID private key seeds the HMAC.
 *
 * Endpoints are lowercased + sorted before hashing so token equality does not
 * depend on caller-provided ordering. An attacker cannot expand the scope of a
 * captured token by adding endpoints, because the HMAC would no longer match.
 *
 * The endpoint set is the access secret here: after canister-side gating of
 * getPushSubscriptions, the only way to learn a real endpoint is to own the
 * principal that registered it, which is the property we want to require.
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
