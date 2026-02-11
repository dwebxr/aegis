import { blockPrivateUrl, blockPrivateHostname, blockPrivateRelay } from "@/lib/utils/url";

describe("blockPrivateHostname — edge cases", () => {
  it("blocks 0.x.x.x range", () => {
    expect(blockPrivateHostname("0.0.0.0")).not.toBeNull();
    expect(blockPrivateHostname("0.1.2.3")).not.toBeNull();
  });

  it("allows boundary IPs just outside private ranges", () => {
    // 10.x.x.x boundary: 10.0.0.0 blocked, 11.0.0.0 allowed
    expect(blockPrivateHostname("10.0.0.0")).not.toBeNull();
    expect(blockPrivateHostname("11.0.0.0")).toBeNull();

    // 172.16-31 boundary
    expect(blockPrivateHostname("172.15.255.255")).toBeNull();
    expect(blockPrivateHostname("172.16.0.0")).not.toBeNull();
    expect(blockPrivateHostname("172.31.255.255")).not.toBeNull();
    expect(blockPrivateHostname("172.32.0.0")).toBeNull();

    // 192.168 boundary
    expect(blockPrivateHostname("192.167.0.1")).toBeNull();
    expect(blockPrivateHostname("192.168.0.0")).not.toBeNull();
    expect(blockPrivateHostname("192.169.0.1")).toBeNull();

    // CGNAT boundary: 100.64.0.0 - 100.127.255.255
    expect(blockPrivateHostname("100.63.255.255")).toBeNull();
    expect(blockPrivateHostname("100.64.0.0")).not.toBeNull();
    expect(blockPrivateHostname("100.127.255.255")).not.toBeNull();
    expect(blockPrivateHostname("100.128.0.0")).toBeNull();
  });

  it("allows regular public IPs", () => {
    expect(blockPrivateHostname("1.1.1.1")).toBeNull();
    expect(blockPrivateHostname("8.8.8.8")).toBeNull();
    expect(blockPrivateHostname("203.0.113.1")).toBeNull();
    expect(blockPrivateHostname("255.255.255.255")).toBeNull();
  });

  it("handles domains that look like IPs but aren't", () => {
    expect(blockPrivateHostname("10.com")).toBeNull();
    expect(blockPrivateHostname("192.168.example.com")).toBeNull();
  });

  it("handles empty and whitespace hostnames", () => {
    expect(blockPrivateHostname("")).toBeNull(); // No IP match, no special hostname
  });
});

describe("blockPrivateUrl — protocol edge cases", () => {
  it("blocks data: URIs", () => {
    expect(blockPrivateUrl("data:text/html,<script>alert(1)</script>")).not.toBeNull();
  });

  it("blocks javascript: URIs", () => {
    expect(blockPrivateUrl("javascript:alert(1)")).not.toBeNull();
  });

  it("allows HTTPS with ports", () => {
    expect(blockPrivateUrl("https://example.com:8443/feed")).toBeNull();
  });

  it("blocks private IPs with ports", () => {
    expect(blockPrivateUrl("http://10.0.0.1:8080/admin")).not.toBeNull();
    expect(blockPrivateUrl("http://192.168.1.1:3000")).not.toBeNull();
  });

  it("handles URL with credentials (user:pass@host)", () => {
    // URL constructor extracts hostname correctly even with credentials
    expect(blockPrivateUrl("http://user:pass@127.0.0.1/")).not.toBeNull();
    expect(blockPrivateUrl("http://user:pass@example.com/")).toBeNull();
  });

  it("handles URL with fragments and query strings", () => {
    expect(blockPrivateUrl("http://127.0.0.1/#fragment")).not.toBeNull();
    expect(blockPrivateUrl("http://192.168.1.1/?key=value")).not.toBeNull();
    expect(blockPrivateUrl("https://example.com/path?q=test#hash")).toBeNull();
  });

  it("handles extremely long URLs", () => {
    const longPath = "/a".repeat(5000);
    expect(blockPrivateUrl(`https://example.com${longPath}`)).toBeNull();
  });
});

describe("blockPrivateRelay — edge cases", () => {
  it("blocks wss:// with private IPs", () => {
    expect(blockPrivateRelay("wss://10.0.0.1")).not.toBeNull();
    expect(blockPrivateRelay("wss://172.16.0.1")).not.toBeNull();
    expect(blockPrivateRelay("wss://192.168.0.1")).not.toBeNull();
  });

  it("handles wss:// with port", () => {
    expect(blockPrivateRelay("wss://relay.example.com:443")).toBeNull();
    expect(blockPrivateRelay("wss://127.0.0.1:9090")).not.toBeNull();
  });

  it("handles wss:// with path", () => {
    expect(blockPrivateRelay("wss://relay.example.com/nostr")).toBeNull();
  });
});
