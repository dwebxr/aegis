import { generatePushToken, isAllowedPushEndpoint } from "@/lib/api/pushToken";
import { createHmac } from "crypto";

describe("generatePushToken", () => {
  const ORIG_KEY = process.env.VAPID_PRIVATE_KEY;

  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = ORIG_KEY;
  });

  it("returns a 64-character hex string with a configured key", () => {
    process.env.VAPID_PRIVATE_KEY = "secret-key";
    const token = generatePushToken("aaaaa-bbbbb-ccccc-ddddd-eee");
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("matches the explicit HMAC-SHA256 reference output", () => {
    process.env.VAPID_PRIVATE_KEY = "deterministic-secret";
    const principal = "principal-1";
    const endpoints = ["https://push.example.com/a", "https://push.example.com/b"];
    // Mirror lib/api/pushToken.ts: lowercase + sort endpoints, NUL-join, then
    // HMAC over `${principal}\0${joined}`. NUL separator avoids field-boundary
    // collisions in case an endpoint contains a literal space or similar.
    const canonical = [...endpoints].map(e => e.toLowerCase()).sort().join("\0");
    const expected = createHmac("sha256", "deterministic-secret")
      .update(`${principal}\0${canonical}`)
      .digest("hex");
    expect(generatePushToken(principal, endpoints)).toBe(expected);
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
      .update("any\0")
      .digest("hex");
    expect(token).toBe(expected);
  });

  it("handles unicode principals safely", () => {
    process.env.VAPID_PRIVATE_KEY = "k";
    const token = generatePushToken("公主-😀");
    expect(token).toHaveLength(64);
  });

  it("handles empty principal", () => {
    process.env.VAPID_PRIVATE_KEY = "k";
    expect(() => generatePushToken("")).not.toThrow();
    expect(generatePushToken("")).toHaveLength(64);
  });
});

describe("isAllowedPushEndpoint — accepted Web Push services", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://fcm.googleapis.com/wp/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QABCD",
  ])("accepts %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "https://sub.push.apple.com/abc",
    "https://wns2-bl2p.notify.windows.com/?token=AwYAAAA",
  ])("accepts host suffix match: %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it("treats hostname case-insensitively", () => {
    expect(isAllowedPushEndpoint("https://FCM.GOOGLEAPIS.COM/fcm/send/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://Web.Push.Apple.com/X")).toBe(true);
  });

  it("ignores port (URL.hostname strips it)", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:443/fcm/send/x")).toBe(true);
  });
});

describe("isAllowedPushEndpoint — rejected hosts", () => {
  it.each([
    "https://attacker.com/relay",
    "https://api.example.com/push",
    "https://fcm.googleapis.com.attacker.com/x",   // hostname spoof
    "https://attacker.notify.windows.com.evil.com/x",
    "https://internal/push",
  ])("rejects unrelated public host: %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it("rejects http:// (TLS required)", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/x")).toBe(false);
  });

  it("rejects non-URL protocols", () => {
    expect(isAllowedPushEndpoint("javascript:alert(1)")).toBe(false);
    expect(isAllowedPushEndpoint("data:text/plain;base64,SGVsbG8=")).toBe(false);
    expect(isAllowedPushEndpoint("file:///etc/passwd")).toBe(false);
    expect(isAllowedPushEndpoint("ftp://fcm.googleapis.com/x")).toBe(false);
  });

  it("rejects malformed / empty inputs", () => {
    expect(isAllowedPushEndpoint("")).toBe(false);
    expect(isAllowedPushEndpoint("not-a-url")).toBe(false);
    expect(isAllowedPushEndpoint("https://")).toBe(false);
  });

  it("rejects suffix-bypass attempts", () => {
    // .push.apple.com suffix must require a leading dot — bare match shouldn't pass.
    expect(isAllowedPushEndpoint("https://faux-push.apple.com.evil/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://notnotify.windows.com.evil/x")).toBe(false);
  });

  it("rejects requests pointing at private addresses even with valid scheme", () => {
    // Hostname allowlist runs at URL level — IP literals not on the list are
    // rejected outright, so SSRF can't slip in through the push send path.
    expect(isAllowedPushEndpoint("https://127.0.0.1/")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/")).toBe(false);
    expect(isAllowedPushEndpoint("https://10.0.0.1/")).toBe(false);
  });
});
