import "server-only";
import { isIP, type LookupFunction } from "node:net";
import { lookup as dnsLookupCb } from "node:dns";

// Authoritative server-side private/reserved address detection. Used by the
// connection-time SSRF guards: safeFetch's undici dispatcher (HTTP) and
// SecureWS's lookup hook (WebSocket relays). Both resolve a hostname to a
// concrete IP and then call checkPrivateAddress on the resolved address,
// closing the DNS-rebinding TOCTOU that a hostname-string check leaves open.
//
// The client-safe, string-only pre-check lives in ./url (blockPrivateHostname)
// and must stay importable in the browser bundle — keep node:net out of there.

export const PRIVATE_ADDR_MSG = "Resolved to a private network address";

function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number);
  if (a > 255 || b > 255 || c > 255) return false;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback (NOT just 127.0.0.1)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  // Special-use / non-globally-routable ranges (RFC 6890) that can still reach
  // internal infrastructure in some environments — treat as private for SSRF.
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 relay anycast
  if (a >= 240) return true; // 240.0.0.0/4 reserved (incl. 255.255.255.255 broadcast)
  return false;
}

// Extract the embedded IPv4 of an IPv4-mapped IPv6 address in EITHER form:
//   ::ffff:127.0.0.1   (dotted tail)  — kept verbatim
//   ::ffff:7f00:1      (hex tail)     — 0x7f000001 → "127.0.0.1"
// Returns the dotted-quad string, or null if not an IPv4-mapped address.
// Canonical IPv4-mapped IPv6 is ::ffff:0:0/96 — the ffff group occupies bits
// 80-96 and every higher group is zero. Anchor to the START so an embedding like
// fc00::ffff:808:808 (a ULA that merely contains "::ffff:") is NOT mistaken for a
// mapped public IPv4 and waved through. Accepts the compressed (::ffff:) and the
// fully/zero-expanded (0:0:0:0:0:ffff:) forms a resolver may emit.
function mappedIPv4(ip: string): string | null {
  const m = ip.toLowerCase().match(/^(?:::ffff:|(?:0{1,4}:){5}ffff:)(.+)$/);
  if (!m) return null;
  const tail = m[1];
  // The tail must be EITHER a strict dotted quad OR exactly two hex groups. A
  // garbled mix (e.g. "dead:127.0.0.1") must NOT be accepted: it would slip past
  // isPrivateIPv4's strict match and be waved through as "public", bypassing the
  // deny-by-default path that would otherwise block its true (zero) first hextet.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail; // ::ffff:127.0.0.1 (dotted)
  const hx = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); // ::ffff:7f00:1 (hex)
  if (!hx) return null;
  const hi = parseInt(hx[1], 16);
  const lo = parseInt(hx[2], 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

// Deny-by-default for IPv6: allow ONLY globally-routable unicast (2000::/3) and
// reject everything else. This catches loopback (::1), unspecified (::), ULA
// (fc00::/7), link-local (fe80::/10), site-local (fec0::/10), multicast (ff00::/8),
// NAT64 (64:ff9b::/96), discard (100::/64), SRv6 (5f00::/16), etc. WITHOUT having to
// enumerate every special-use prefix. Carve-outs that live inside 2000::/3 but are
// non-routable or tunnel into other address space are denied explicitly.
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped (::ffff:a.b.c.d, dotted or hex form) → judged by the embedded IPv4.
  const mapped = mappedIPv4(lower);
  if (mapped) return isPrivateIPv4(mapped);
  const parts = lower.split(":");
  const h0 = parseInt(parts[0] || "0", 16) || 0;
  const h1 = parts[1] ? parseInt(parts[1], 16) || 0 : 0;
  if (h0 < 0x2000 || h0 > 0x3fff) return true; // not global unicast 2000::/3
  if (h0 === 0x2001) {
    // 2001::/23 is the IETF special-purpose block (Teredo, benchmarking, ORCHID,
    // AS112, protocol assignments…) — non-global apart from a few anycast /128s;
    // deny the whole /23. Real global allocations start at 2001:200::/23.
    if (h1 <= 0x01ff) return true;
    if (h1 === 0x0db8) return true; // 2001:db8::/32 documentation (sits outside the /23)
  }
  if (h0 === 0x2002) return true; // 2002::/16 6to4 (can embed private IPv4)
  if (h0 === 0x3fff && (h1 & 0xf000) === 0) return true; // 3fff::/20 documentation (RFC 9637), NOT all of /16
  return false;
}

// Returns a rejection reason string if `ip` is a private/reserved address, else
// null. `family` (4 or 6) may be supplied by the resolver; when omitted it is
// inferred. A value that is not a recognizable IP literal returns null — callers
// must resolve hostnames to IPs before calling this.
export function checkPrivateAddress(ip: string, family?: number): string | null {
  const host = ip.replace(/^\[|\]$/g, "");
  const fam = family && (family === 4 || family === 6) ? family : isIP(host);
  if (fam === 4) return isPrivateIPv4(host) ? PRIVATE_ADDR_MSG : null;
  if (fam === 6) return isPrivateIPv6(host) ? PRIVATE_ADDR_MSG : null;
  return null;
}

type ResolvedAddr = { address: string; family: number };
type LookupAll = (
  hostname: string,
  opts: { all: true; verbatim: true },
  cb: (err: NodeJS.ErrnoException | null, addrs: ResolvedAddr[]) => void,
) => void;
// net.connect's lookup callback is overloaded: with `{ all: true }` it expects an
// array; otherwise the single-address (err, address, family) form.
type ConnectLookupCb = (
  err: Error | null,
  address: string | ResolvedAddr[],
  family?: number,
) => void;

// Builds a `lookup` function with the net.connect/tls.connect signature, shared
// by the WebSocket relay guard (ws) and the HTTP guard (undici Agent.connect).
// It resolves the hostname, rejects fail-closed if ANY resolved address is
// private/reserved, and otherwise pins the connection to the first validated
// address — so the socket connects to exactly the IP we checked, leaving no
// second-resolution window for DNS rebinding. The resolver is injectable for tests.
//
// IMPORTANT: on Node 20+ `autoSelectFamily` is on by default, so undici/ws invoke
// this with `{ all: true }` and require the callback to receive an ADDRESS ARRAY.
// Returning the legacy single-address form there fails with ERR_INVALID_IP_ADDRESS
// and breaks every hostname connection — so honor opts.all.
export function makePrivateIPRejectingLookup(
  dnsLookupAll: LookupAll = dnsLookupCb as unknown as LookupAll,
): LookupFunction {
  const lookup = (
    hostname: string,
    opts: { all?: boolean; family?: number | string } | undefined,
    cb: ConnectLookupCb,
  ): void => {
    dnsLookupAll(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return cb(err, "", 0);
      for (const a of addresses) {
        const bad = checkPrivateAddress(a.address, a.family);
        if (bad) {
          return cb(new Error(`SSRF blocked: ${hostname} -> ${a.address} - ${bad}`), "", a.family);
        }
      }
      if (addresses.length === 0) return cb(new Error(`No addresses resolved for ${hostname}`), "", 0);
      if (opts && opts.all) {
        // Every resolved address has been validated as public, so return the WHOLE
        // set (optionally narrowed to the requested family). This pins to addresses
        // we checked — no second resolution — while preserving Happy Eyeballs, so a
        // host that is reachable on only one of its addresses still connects.
        const fam = opts.family === 4 || opts.family === 6 ? opts.family : 0;
        const filtered = fam ? addresses.filter((a) => a.family === fam) : addresses;
        const out = (filtered.length ? filtered : addresses).map((a) => ({ address: a.address, family: a.family }));
        cb(null, out);
      } else {
        const chosen = addresses[0];
        cb(null, chosen.address, chosen.family);
      }
    });
  };
  return lookup as unknown as LookupFunction;
}
