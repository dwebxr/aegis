import { createHmac } from "crypto";

/** HMAC-SHA256 token derived from principal + VAPID private key to prevent unauthorized push spam. */
export function generatePushToken(principal: string): string {
  const secret = process.env.VAPID_PRIVATE_KEY || "";
  return createHmac("sha256", secret).update(principal).digest("hex").slice(0, 32);
}
