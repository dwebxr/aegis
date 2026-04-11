import { generatePushToken } from "@/lib/api/pushToken";
import { createHmac } from "crypto";

describe("generatePushToken", () => {
  const ORIG_KEY = process.env.VAPID_PRIVATE_KEY;

  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = ORIG_KEY;
  });

  it("returns a 32-character hex string with a configured key", () => {
    process.env.VAPID_PRIVATE_KEY = "secret-key";
    const token = generatePushToken("aaaaa-bbbbb-ccccc-ddddd-eee");
    expect(token).toHaveLength(32);
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("matches the explicit HMAC-SHA256-truncated reference output", () => {
    process.env.VAPID_PRIVATE_KEY = "deterministic-secret";
    const principal = "principal-1";
    const expected = createHmac("sha256", "deterministic-secret")
      .update(principal)
      .digest("hex")
      .slice(0, 32);
    expect(generatePushToken(principal)).toBe(expected);
  });

  it("is deterministic for identical inputs", () => {
    process.env.VAPID_PRIVATE_KEY = "k";
    expect(generatePushToken("p")).toBe(generatePushToken("p"));
  });

  it("differs across distinct principals", () => {
    process.env.VAPID_PRIVATE_KEY = "k";
    const a = generatePushToken("alice");
    const b = generatePushToken("bob");
    expect(a).not.toBe(b);
  });

  it("differs across distinct secrets for the same principal", () => {
    process.env.VAPID_PRIVATE_KEY = "secret-a";
    const a = generatePushToken("alice");
    process.env.VAPID_PRIVATE_KEY = "secret-b";
    const b = generatePushToken("alice");
    expect(a).not.toBe(b);
  });

  it("falls back to empty secret when env var is unset", () => {
    delete process.env.VAPID_PRIVATE_KEY;
    const token = generatePushToken("any");
    const expected = createHmac("sha256", "")
      .update("any")
      .digest("hex")
      .slice(0, 32);
    expect(token).toBe(expected);
  });

  it("handles unicode principals safely", () => {
    process.env.VAPID_PRIVATE_KEY = "k";
    const token = generatePushToken("公主-😀");
    expect(token).toHaveLength(32);
  });

  it("handles empty principal", () => {
    process.env.VAPID_PRIVATE_KEY = "k";
    expect(() => generatePushToken("")).not.toThrow();
    expect(generatePushToken("")).toHaveLength(32);
  });
});
