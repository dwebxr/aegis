// Client-safe URL helpers — no Node.js builtins. The server-only SSRF-safe
// fetcher (safeFetch, DNS-resolution based private-IP block) lives in
// lib/utils/safeFetch.server.ts so this file remains bundleable in the browser.
export function extractUrl(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return trimmed;
  } catch { /* not a bare URL */ }
  const match = trimmed.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
  return match ? match[0] : null;
}

// Client-safe, string-only pre-check. This is an early/defense-in-depth filter,
// NOT the security boundary — the authoritative SSRF guard is connection-time DNS
// pinning (see lib/utils/ssrf.ts: checkPrivateAddress + makePrivateIPRejectingLookup,
// used by safeFetch's undici dispatcher and the Nostr SecureWS). Keep these rules
// aligned with ssrf.ts so the early error matches the eventual connect-time block.
// Keep this CIDR set in sync with isPrivateIPv4 in lib/utils/ssrf.ts (the
// authoritative connection-time check); this is the client-safe early filter.
function privateIPv4Reason(a: number, b: number, c: number): string | null {
  if (a === 0) return "Invalid URL target";                                  // 0.0.0.0/8
  if (a === 10) return "Private network URLs are not allowed";               // 10.0.0.0/8
  if (a === 127) return "Localhost URLs are not allowed";                    // 127.0.0.0/8 (not just .1)
  if (a === 172 && b >= 16 && b <= 31) return "Private network URLs are not allowed"; // 172.16.0.0/12
  if (a === 192 && b === 168) return "Private network URLs are not allowed"; // 192.168.0.0/16
  if (a === 169 && b === 254) return "Link-local URLs are not allowed";      // 169.254.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return "Private network URLs are not allowed"; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return "Reserved network URLs are not allowed"; // 198.18.0.0/15
  if (a === 192 && b === 0 && c === 0) return "Reserved network URLs are not allowed";     // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return "Reserved network URLs are not allowed";     // 192.0.2.0/24
  if (a === 198 && b === 51 && c === 100) return "Reserved network URLs are not allowed";  // 198.51.100.0/24
  if (a === 203 && b === 0 && c === 113) return "Reserved network URLs are not allowed";   // 203.0.113.0/24
  if (a === 192 && b === 88 && c === 99) return "Reserved network URLs are not allowed";   // 192.88.99.0/24
  if (a >= 240) return "Reserved network URLs are not allowed";                            // 240.0.0.0/4
  return null;
}

// Extract the dotted-quad of an IPv4-mapped IPv6 host in dotted (::ffff:127.0.0.1)
// or hex (::ffff:7f00:1) form. Pure JS — no node builtins (stays browser-safe).
// Anchored to the canonical ::ffff:0:0/96 prefix so an embedding such as
// fc00::ffff:808:808 (a ULA) is not misread as a mapped public IPv4. Mirrors
// mappedIPv4 in lib/utils/ssrf.ts.
function mappedIPv4(h: string): string | null {
  const m = h.match(/^(?:::ffff:|(?:0{1,4}:){5}ffff:)(.+)$/);
  if (!m) return null;
  const tail = m[1];
  // Strict dotted quad OR exactly two hex groups — reject garbled ":."-mixed tails
  // so they fall through to the deny-by-default path (mirrors ssrf.ts mappedIPv4).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail;
  const hx = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hx) return null;
  const hi = parseInt(hx[1], 16);
  const lo = parseInt(hx[2], 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function blockPrivateHostname(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (h === "localhost" || h === "0.0.0.0") {
    return "Localhost URLs are not allowed";
  }

  // IPv4 literal
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b, c] = ipv4.map(Number);
    const reason = privateIPv4Reason(a, b, c);
    if (reason) return reason;
  }

  // IPv6 literal (brackets already stripped). Mirror isPrivateIPv6 in ssrf.ts:
  // allow ONLY global unicast 2000::/3, deny everything else (deny-by-default).
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return "Localhost URLs are not allowed";
    const mapped = mappedIPv4(h);
    if (mapped) {
      const m = mapped.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\./);
      if (m) {
        const reason = privateIPv4Reason(Number(m[1]), Number(m[2]), Number(m[3]));
        if (reason) return reason;
      }
      return null; // ::ffff:<public IPv4> is allowed
    }
    const parts = h.split(":");
    const h0 = parseInt(parts[0] || "0", 16) || 0;
    const h1 = parts[1] ? parseInt(parts[1], 16) || 0 : 0;
    if (h0 < 0x2000 || h0 > 0x3fff) return "Private network URLs are not allowed"; // not 2000::/3
    if (h0 === 0x2001 && h1 <= 0x01ff) return "Reserved network URLs are not allowed"; // 2001::/23 IETF special-purpose (Teredo/benchmark/ORCHID/AS112/…)
    if (h0 === 0x2001 && h1 === 0x0db8) return "Reserved network URLs are not allowed"; // 2001:db8::/32 (outside /23)
    if (h0 === 0x2002) return "Reserved network URLs are not allowed"; // 2002::/16 6to4
    if (h0 === 0x3fff && (h1 & 0xf000) === 0) return "Reserved network URLs are not allowed"; // 3fff::/20 documentation
  }

  // Block cloud metadata endpoints
  if (h === "metadata.google.internal" || h === "169.254.169.254") {
    return "Cloud metadata URLs are not allowed";
  }

  return null;
}

export function blockPrivateUrl(urlString: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return "Invalid URL format";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only HTTP/HTTPS URLs are allowed";
  }

  return blockPrivateHostname(parsed.hostname);
}

export function blockPrivateRelay(relayUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(relayUrl);
  } catch {
    return "Invalid relay URL format";
  }

  if (parsed.protocol !== "wss:") {
    return "Relay URL must use wss:// protocol";
  }

  return blockPrivateHostname(parsed.hostname);
}

// safeFetch lives in lib/utils/safeFetch.server.ts — import it directly from
// server-side code. It is NOT re-exported here because that would pull
// node:net / node:dns into the client bundle via this client-safe module.
