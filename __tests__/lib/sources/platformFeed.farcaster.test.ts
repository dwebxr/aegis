import { parseFarcasterUser } from "@/lib/sources/platformFeed";

describe("parseFarcasterUser", () => {
  it("parses bare username", () => {
    expect(parseFarcasterUser("vitalik")).toEqual({ username: "vitalik" });
  });

  it("parses @username", () => {
    expect(parseFarcasterUser("@vitalik")).toEqual({ username: "vitalik" });
  });

  it("parses Warpcast URL", () => {
    expect(parseFarcasterUser("https://warpcast.com/vitalik")).toEqual({ username: "vitalik" });
  });

  it("parses Warpcast URL with trailing slash", () => {
    expect(parseFarcasterUser("https://warpcast.com/vitalik/")).toEqual({ username: "vitalik" });
  });

  it("parses Warpcast URL with www", () => {
    expect(parseFarcasterUser("https://www.warpcast.com/vitalik")).toEqual({ username: "vitalik" });
  });

  it("parses http Warpcast URL", () => {
    expect(parseFarcasterUser("http://warpcast.com/vitalik")).toEqual({ username: "vitalik" });
  });

  it("handles username with dots", () => {
    expect(parseFarcasterUser("v.buterin")).toEqual({ username: "v.buterin" });
  });

  it("handles username with hyphens", () => {
    expect(parseFarcasterUser("vitalik-eth")).toEqual({ username: "vitalik-eth" });
  });

  it("handles username with underscores", () => {
    expect(parseFarcasterUser("vitalik_eth")).toEqual({ username: "vitalik_eth" });
  });

  it("handles mixed special characters", () => {
    expect(parseFarcasterUser("user.name-test_1")).toEqual({ username: "user.name-test_1" });
  });

  it("trims whitespace", () => {
    expect(parseFarcasterUser("  vitalik  ")).toEqual({ username: "vitalik" });
  });

  it("returns error for empty string", () => {
    expect(parseFarcasterUser("")).toHaveProperty("error");
  });

  it("returns error for whitespace only", () => {
    expect(parseFarcasterUser("   ")).toHaveProperty("error");
  });

  it("returns error for username too long (>20 chars)", () => {
    expect(parseFarcasterUser("a".repeat(21))).toHaveProperty("error");
  });

  it("returns error for invalid characters", () => {
    expect(parseFarcasterUser("user name")).toHaveProperty("error");
    expect(parseFarcasterUser("user@domain")).toHaveProperty("error");
    expect(parseFarcasterUser("user!")).toHaveProperty("error");
  });

  it("returns error for Warpcast URL with deep path", () => {
    expect(parseFarcasterUser("https://warpcast.com/vitalik/0xabc123")).toHaveProperty("error");
  });

  it("accepts single character username", () => {
    expect(parseFarcasterUser("a")).toEqual({ username: "a" });
  });

  it("accepts max length username (20 chars)", () => {
    const name = "a".repeat(20);
    expect(parseFarcasterUser(name)).toEqual({ username: name });
  });
});
