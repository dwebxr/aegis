import "server-only";
import { Agent, fetch as undiciFetch } from "undici";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { blockPrivateUrl } from "./url";
import { checkPrivateAddress, makePrivateIPRejectingLookup } from "./ssrf";

// Authoritative SSRF enforcement happens at connection time: this dispatcher's
// connect step resolves the host, rejects fail-closed if any A/AAAA is private,
// and pins the socket to the validated IP. Because undici applies the dispatcher
// to every connection — including redirect targets we follow manually below —
// there is no resolve-then-reconnect window for DNS rebinding to exploit.
const ssrfDispatcher = new Agent({ connect: { lookup: makePrivateIPRejectingLookup() } });

// Best-effort pre-check for a clean, early error on obviously-private targets.
// It is NOT the security boundary (a pre-resolve can race the real connection);
// the connect-time lookup in ssrfDispatcher is. Hence resolution failure here is
// non-fatal — the dispatcher re-resolves and fails closed if it points private.
async function preCheckHost(hostname: string): Promise<string | null> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const fam = isIP(host);
  if (fam !== 0) return checkPrivateAddress(host, fam);
  try {
    const results = await lookup(host, { all: true, verbatim: true });
    for (const { address, family } of results) {
      const bad = checkPrivateAddress(address, family);
      if (bad) return bad;
    }
  } catch {
    // Deferred to the connect-time lookup, which fails closed.
  }
  return null;
}

// SSRF-safe: pre-check + connect-time pinning on every hop, including redirects.
export async function safeFetch(
  url: string,
  init?: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const blocked = blockPrivateUrl(current);
    if (blocked) throw new Error(blocked);
    const parsed = new URL(current);
    const pre = await preCheckHost(parsed.hostname);
    if (pre) throw new Error(pre);
    type UndiciInit = NonNullable<Parameters<typeof undiciFetch>[1]>;
    const res = await undiciFetch(current, {
      ...(init as unknown as UndiciInit),
      redirect: "manual",
      dispatcher: ssrfDispatcher,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res as unknown as Response;
      current = new URL(location, current).href;
      continue;
    }
    return res as unknown as Response;
  }
  throw new Error("Too many redirects");
}
