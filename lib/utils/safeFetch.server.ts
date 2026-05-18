import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { blockPrivateUrl } from "./url";

function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = m.slice(1).map(Number);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  if (lower.startsWith("::ffff:")) return isPrivateIPv4(lower.slice(7));
  return false;
}

const PRIVATE_ADDR_MSG = "Resolved to a private network address";

function checkAddress(address: string, family: number): boolean {
  return (family === 4 && isPrivateIPv4(address)) || (family === 6 && isPrivateIPv6(address));
}

// Resolve hostname via DNS and reject if any A/AAAA record points at a private
// IP range. Mitigates DNS-rebinding bypass of hostname-based filtering.
async function resolveAndCheckHost(hostname: string): Promise<string | null> {
  // URL.hostname may keep brackets around IPv6 literals depending on the runtime.
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  if (family !== 0) {
    return checkAddress(host, family) ? PRIVATE_ADDR_MSG : null;
  }
  try {
    const results = await lookup(host, { all: true, verbatim: true });
    for (const { address, family: f } of results) {
      if (checkAddress(address, f)) return PRIVATE_ADDR_MSG;
    }
  } catch (err) {
    // DNS failure — defer to fetch for a more meaningful error. Logged at
    // debug level (Sentry captureConsole only forwards warn+error) because
    // transient NXDOMAIN is noise; the fetch error that follows will fire
    // a real alert.
    console.debug("[safeFetch] DNS lookup failed for", host, err);
  }
  return null;
}

// SSRF-safe: every redirect target is re-validated and DNS-resolved before following.
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
    const dnsBlocked = await resolveAndCheckHost(parsed.hostname);
    if (dnsBlocked) throw new Error(dnsBlocked);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).href;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
