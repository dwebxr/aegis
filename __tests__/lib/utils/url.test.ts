import { blockPrivateUrl, blockPrivateHostname, blockPrivateRelay } from "@/lib/utils/url";

describe("blockPrivateHostname", () => {
  it("allows public hostnames", () => {
    expect(blockPrivateHostname("example.com")).toBeNull();
    expect(blockPrivateHostname("8.8.8.8")).toBeNull();
    expect(blockPrivateHostname("relay.damus.io")).toBeNull();
  });

  it("blocks localhost variants", () => {
    expect(blockPrivateHostname("localhost")).not.toBeNull();
    expect(blockPrivateHostname("127.0.0.1")).not.toBeNull();
    expect(blockPrivateHostname("::1")).not.toBeNull();
    expect(blockPrivateHostname("0.0.0.0")).not.toBeNull();
  });

  it("blocks private RFC 1918 ranges", () => {
    expect(blockPrivateHostname("10.0.0.1")).not.toBeNull();
    expect(blockPrivateHostname("172.16.0.1")).not.toBeNull();
    expect(blockPrivateHostname("172.31.255.255")).not.toBeNull();
    expect(blockPrivateHostname("192.168.1.1")).not.toBeNull();
  });

  it("allows 172.x outside 16-31 range", () => {
    expect(blockPrivateHostname("172.15.0.1")).toBeNull();
    expect(blockPrivateHostname("172.32.0.1")).toBeNull();
  });

  it("blocks link-local (169.254.x.x)", () => {
    expect(blockPrivateHostname("169.254.1.1")).not.toBeNull();
  });

  it("blocks cloud metadata endpoints", () => {
    expect(blockPrivateHostname("169.254.169.254")).not.toBeNull();
    expect(blockPrivateHostname("metadata.google.internal")).not.toBeNull();
  });

  it("blocks CGNAT range (100.64-127.x.x)", () => {
    expect(blockPrivateHostname("100.64.0.1")).not.toBeNull();
    expect(blockPrivateHostname("100.127.255.255")).not.toBeNull();
  });

  it("allows 100.x outside CGNAT", () => {
    expect(blockPrivateHostname("100.63.0.1")).toBeNull();
    expect(blockPrivateHostname("100.128.0.1")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(blockPrivateHostname("LOCALHOST")).not.toBeNull();
    expect(blockPrivateHostname("Metadata.Google.Internal")).not.toBeNull();
  });
});

describe("blockPrivateUrl", () => {
  it("allows valid public HTTP URLs", () => {
    expect(blockPrivateUrl("https://example.com/feed.xml")).toBeNull();
    expect(blockPrivateUrl("http://news.ycombinator.com")).toBeNull();
    expect(blockPrivateUrl("https://8.8.8.8/path")).toBeNull();
  });

  it("blocks localhost", () => {
    expect(blockPrivateUrl("http://localhost/secret")).not.toBeNull();
    expect(blockPrivateUrl("http://127.0.0.1/admin")).not.toBeNull();
    expect(blockPrivateUrl("http://0.0.0.0")).not.toBeNull();
  });

  it("blocks private RFC 1918 ranges", () => {
    expect(blockPrivateUrl("http://10.0.0.1/internal")).not.toBeNull();
    expect(blockPrivateUrl("http://172.16.0.1/admin")).not.toBeNull();
    expect(blockPrivateUrl("http://172.31.255.255")).not.toBeNull();
    expect(blockPrivateUrl("http://192.168.1.1")).not.toBeNull();
  });

  it("allows 172.x outside 16-31 range", () => {
    expect(blockPrivateUrl("http://172.15.0.1")).toBeNull();
    expect(blockPrivateUrl("http://172.32.0.1")).toBeNull();
  });

  it("blocks link-local (169.254.x.x)", () => {
    expect(blockPrivateUrl("http://169.254.169.254/metadata")).not.toBeNull();
  });

  it("blocks cloud metadata endpoints", () => {
    expect(blockPrivateUrl("http://169.254.169.254/latest/meta-data/")).not.toBeNull();
    expect(blockPrivateUrl("http://metadata.google.internal/computeMetadata/v1/")).not.toBeNull();
  });

  it("blocks CGNAT range (100.64-127.x.x)", () => {
    expect(blockPrivateUrl("http://100.64.0.1")).not.toBeNull();
    expect(blockPrivateUrl("http://100.127.255.255")).not.toBeNull();
  });

  it("allows 100.x outside CGNAT", () => {
    expect(blockPrivateUrl("http://100.63.0.1")).toBeNull();
    expect(blockPrivateUrl("http://100.128.0.1")).toBeNull();
  });

  it("blocks non-HTTP protocols", () => {
    expect(blockPrivateUrl("ftp://example.com")).not.toBeNull();
    expect(blockPrivateUrl("file:///etc/passwd")).not.toBeNull();
  });

  it("returns error for invalid URLs", () => {
    expect(blockPrivateUrl("not-a-url")).not.toBeNull();
    expect(blockPrivateUrl("")).not.toBeNull();
  });
});

describe("blockPrivateRelay", () => {
  it("allows valid public wss:// relays", () => {
    expect(blockPrivateRelay("wss://relay.damus.io")).toBeNull();
    expect(blockPrivateRelay("wss://nos.lol")).toBeNull();
    expect(blockPrivateRelay("wss://relay.nostr.band")).toBeNull();
  });

  it("blocks non-wss protocols", () => {
    expect(blockPrivateRelay("http://relay.damus.io")).not.toBeNull();
    expect(blockPrivateRelay("https://relay.damus.io")).not.toBeNull();
    expect(blockPrivateRelay("ftp://relay.damus.io")).not.toBeNull();
  });

  it("blocks localhost relays", () => {
    expect(blockPrivateRelay("wss://localhost")).not.toBeNull();
    expect(blockPrivateRelay("wss://127.0.0.1")).not.toBeNull();
    expect(blockPrivateRelay("wss://0.0.0.0")).not.toBeNull();
  });

  it("blocks private IP relays", () => {
    expect(blockPrivateRelay("wss://10.0.0.1")).not.toBeNull();
    expect(blockPrivateRelay("wss://192.168.1.1")).not.toBeNull();
    expect(blockPrivateRelay("wss://172.16.0.1")).not.toBeNull();
  });

  it("blocks cloud metadata via relay", () => {
    expect(blockPrivateRelay("wss://169.254.169.254")).not.toBeNull();
    expect(blockPrivateRelay("wss://metadata.google.internal")).not.toBeNull();
  });

  it("returns error for invalid URLs", () => {
    expect(blockPrivateRelay("not-a-url")).not.toBeNull();
    expect(blockPrivateRelay("")).not.toBeNull();
  });

  it("blocks ws:// protocol (require TLS)", () => {
    expect(blockPrivateRelay("ws://relay.example.com")).not.toBeNull();
  });
});
