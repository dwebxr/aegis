import { checkPrivateAddress } from "@/lib/utils/ssrf";
import { blockPrivateHostname } from "@/lib/utils/url";

// Drift guard for the two private-IP layers that MUST encode the same ranges:
//  - ssrf.ts `checkPrivateAddress`  — authoritative connection-time IP check (server)
//  - url.ts  `blockPrivateHostname` — client-safe string pre-check
// Each row asserts BOTH layers reach the same block/allow verdict AND that it matches
// the known-correct expectation. If either file's ranges drift, its assertion fails.
const CORPUS: Array<[string, boolean]> = [
  // IPv4 — private / reserved (BLOCK)
  ["10.0.0.1", true],
  ["127.0.0.1", true],
  ["192.168.1.1", true],
  ["172.16.5.5", true],
  ["172.31.255.255", true],
  ["169.254.169.254", true],
  ["100.100.0.1", true],
  ["198.18.0.1", true],
  ["192.0.0.1", true],
  ["192.0.2.5", true],
  ["198.51.100.5", true],
  ["203.0.113.5", true],
  ["192.88.99.5", true],
  ["240.0.0.1", true],
  ["255.255.255.255", true],
  // IPv4 — public (ALLOW)
  ["8.8.8.8", false],
  ["1.1.1.1", false],
  ["93.184.216.34", false],
  ["203.0.114.5", false], // adjacent to 203.0.113/24 but public
  // IPv6 — non-global / reserved (BLOCK, deny-by-default outside 2000::/3 + carve-outs)
  ["::1", true],
  ["fc00::1", true],
  ["fe80::1", true],
  ["2001:db8::1", true],
  ["2002::1", true],
  ["::ffff:10.0.0.1", true],
  ["::ffff:127.0.0.1", true],
  // IPv6 — global unicast (ALLOW)
  ["2606:4700:4700::1111", false],
  ["2620:fe::fe", false],
  ["::ffff:8.8.8.8", false],
];

describe("private-IP parity: ssrf.ts ↔ url.ts", () => {
  it.each(CORPUS)("%s → blocked=%s in both layers", (ip, shouldBlock) => {
    expect(checkPrivateAddress(ip) !== null).toBe(shouldBlock);
    expect(blockPrivateHostname(ip) !== null).toBe(shouldBlock);
  });
});
