import { blockPrivateUrl } from "@/lib/utils/url";

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
