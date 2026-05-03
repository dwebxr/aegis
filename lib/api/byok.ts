import { NextRequest } from "next/server";

const HEADER = "x-user-api-key";
const PREFIX = "sk-ant-";

interface ByokResolution {
  key: string | null;
  isUser: boolean;
}

// BYOK header (sk-ant-) wins; falls back to ANTHROPIC_API_KEY. BYOK-only routes use requireUserByokKey().
export function resolveAnthropicKey(request: NextRequest): ByokResolution {
  const userKey = request.headers.get(HEADER);
  const isUser = !!userKey && userKey.startsWith(PREFIX);
  if (isUser) return { key: userKey, isUser: true };
  const serverKey = process.env.ANTHROPIC_API_KEY?.trim();
  return { key: serverKey || null, isUser: false };
}

// BYOK-only: never consults server fallback (e.g. /api/translate).
export function requireUserByokKey(request: NextRequest): string | null {
  const userKey = request.headers.get(HEADER);
  if (!userKey || !userKey.startsWith(PREFIX)) return null;
  return userKey;
}
