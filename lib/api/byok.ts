import { NextRequest } from "next/server";

const HEADER = "x-user-api-key";
const PREFIX = "sk-ant-";

export interface ByokResolution {
  /** The key to send to Anthropic, or null if neither user nor server key is available. */
  key: string | null;
  /** True when the resolved key came from the request header (BYOK). */
  isUser: boolean;
}

/**
 * Resolves the Anthropic API key for a request.
 *
 * - If the caller supplies a valid `x-user-api-key` header (must start with
 *   `sk-ant-`), use it (BYOK path — caller's quota).
 * - Otherwise fall back to the server's `ANTHROPIC_API_KEY` env var.
 * - Returns `key: null` only when neither is available.
 *
 * Routes that REQUIRE BYOK (e.g. /api/translate) should call
 * `requireUserByokKey()` instead, which returns null when the caller didn't
 * supply a valid header even if the server has one.
 */
export function resolveAnthropicKey(request: NextRequest): ByokResolution {
  const userKey = request.headers.get(HEADER);
  const isUser = !!userKey && userKey.startsWith(PREFIX);
  if (isUser) return { key: userKey, isUser: true };
  const serverKey = process.env.ANTHROPIC_API_KEY?.trim();
  return { key: serverKey || null, isUser: false };
}

/**
 * Returns the user's `sk-ant-`-prefixed key from the request, or null if the
 * header is missing or malformed. Server fallback is NOT consulted —
 * suitable for endpoints whose policy is BYOK-only (e.g. /api/translate).
 */
export function requireUserByokKey(request: NextRequest): string | null {
  const userKey = request.headers.get(HEADER);
  if (!userKey || !userKey.startsWith(PREFIX)) return null;
  return userKey;
}
