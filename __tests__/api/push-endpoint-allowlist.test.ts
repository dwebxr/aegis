/**
 * /api/push/token + /api/push/send — endpoint allowlist + canister authz
 * regression tests (codex finding #11).
 *
 * Two-layer defence:
 *   1. Endpoint allowlist — only known Web Push hosts (FCM, Mozilla, Apple,
 *      Microsoft notify.windows.com) make it past the input validator.
 *   2. Canister authz — server uses a controller identity to call
 *      getPushSubscriptions(principal) and verifies the caller-supplied
 *      endpoints are actually registered to that principal. Without this,
 *      an attacker with their own allowlisted endpoint could mint a token
 *      for any victim principal and use the server as a push relay.
 *
 * These tests stub the canister actor so they can drive both registered
 * and unregistered endpoint scenarios deterministically.
 */
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

jest.mock("@/lib/featureFlags", () => ({
  isFeatureEnabled: () => true,
}));

jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({ statusCode: 201 }),
}));

// Stub the server-controller actor — we don't want token tests to call a
// real canister. The shape mirrors the canister's getPushSubscriptions return.
const mockGetPushSubscriptions = jest.fn();
jest.mock("@/lib/ic/actor.server", () => ({
  createServerControllerActorAsync: jest.fn(async () => ({
    getPushSubscriptions: (...args: unknown[]) => mockGetPushSubscriptions(...args),
  })),
}));

import { POST as TOKEN_POST } from "@/app/api/push/token/route";
import { POST as SEND_POST } from "@/app/api/push/send/route";
import { generatePushToken } from "@/lib/api/pushToken";

const ORIG_VAPID = process.env.VAPID_PRIVATE_KEY;
const ORIG_VAPID_PUB = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

beforeAll(() => {
  process.env.VAPID_PRIVATE_KEY = "test-vapid-secret-for-hmac";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";
});

afterAll(() => {
  if (ORIG_VAPID === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = ORIG_VAPID;
  if (ORIG_VAPID_PUB === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = ORIG_VAPID_PUB;
});

beforeEach(() => {
  _resetRateLimits();
  mockGetPushSubscriptions.mockReset();
  // Default to "principal has registered the requested FCM endpoint" so the
  // allowlist tests don't need to repeat the setup. Specific authz tests
  // override per-call.
  mockGetPushSubscriptions.mockResolvedValue([
    { endpoint: FCM_ENDPOINT, keys: { p256dh: "x", auth: "y" }, createdAt: 0n },
    { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "x", auth: "y" }, createdAt: 0n },
  ]);
});

const VALID_PRINCIPAL = "aaaaa-aa";

function tokenRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/push/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `1.2.3.${Math.floor(Math.random() * 254 + 1)}` },
    body: JSON.stringify(body),
  });
}

function sendRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `1.2.3.${Math.floor(Math.random() * 254 + 1)}` },
    body: JSON.stringify(body),
  });
}

const FCM_ENDPOINT = "https://fcm.googleapis.com/fcm/send/aaa";
const ATTACKER_ENDPOINT = "https://attacker.example/recv";

describe("/api/push/token — endpoint allowlist", () => {
  it("mints a token when ALL endpoints are on the allowlist", async () => {
    const res = await TOKEN_POST(tokenRequest({
      principal: VALID_PRINCIPAL,
      endpoints: [FCM_ENDPOINT, "https://web.push.apple.com/abc"],
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("rejects (400) when ANY endpoint is off-allowlist (attacker relay)", async () => {
    const res = await TOKEN_POST(tokenRequest({
      principal: VALID_PRINCIPAL,
      endpoints: [ATTACKER_ENDPOINT],
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Web Push service/);
  });

  it("rejects (400) when principal text is malformed", async () => {
    const res = await TOKEN_POST(tokenRequest({
      principal: "not-a-valid-principal",
      endpoints: [FCM_ENDPOINT],
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Principal text/);
  });

  it("rejects mixed allowed + disallowed endpoints (single bad apple = reject)", async () => {
    const res = await TOKEN_POST(tokenRequest({
      principal: VALID_PRINCIPAL,
      endpoints: [FCM_ENDPOINT, ATTACKER_ENDPOINT],
    }));
    expect(res.status).toBe(400);
  });

  it("rejects subdomain spoofing (host suffix must match boundary)", async () => {
    const res = await TOKEN_POST(tokenRequest({
      principal: VALID_PRINCIPAL,
      endpoints: ["https://fcm.googleapis.com.attacker.dev/fcm/send/x"],
    }));
    expect(res.status).toBe(400);
  });

  it("rejects http:// even for allowlisted host (TLS required)", async () => {
    const res = await TOKEN_POST(tokenRequest({
      principal: VALID_PRINCIPAL,
      endpoints: ["http://fcm.googleapis.com/fcm/send/aaa"],
    }));
    expect(res.status).toBe(400);
  });
});

describe("/api/push/token — canister authz (subscription ownership)", () => {
  it("rejects (403) when caller-supplied endpoint is allowlisted but NOT registered on canister", async () => {
    // Attacker controls their own FCM endpoint; victim has never registered it.
    const ATTACKER_FCM = "https://fcm.googleapis.com/fcm/send/attacker-controlled";
    mockGetPushSubscriptions.mockResolvedValueOnce([
      // Victim has registered something else entirely.
      { endpoint: FCM_ENDPOINT, keys: { p256dh: "x", auth: "y" }, createdAt: 0n },
    ]);
    const res = await TOKEN_POST(tokenRequest({
      principal: VALID_PRINCIPAL,
      endpoints: [ATTACKER_FCM],
    }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/not registered for principal/);
  });

  it("rejects (403) when even ONE endpoint in the set is unregistered", async () => {
    const REGISTERED = "https://fcm.googleapis.com/fcm/send/registered";
    const UNREGISTERED = "https://web.push.apple.com/not-registered";
    mockGetPushSubscriptions.mockResolvedValueOnce([
      { endpoint: REGISTERED, keys: { p256dh: "x", auth: "y" }, createdAt: 0n },
    ]);
    const res = await TOKEN_POST(tokenRequest({
      principal: VALID_PRINCIPAL,
      endpoints: [REGISTERED, UNREGISTERED],
    }));
    expect(res.status).toBe(403);
  });

  it("mints token when ALL endpoints are registered to the principal", async () => {
    const EP1 = "https://fcm.googleapis.com/fcm/send/one";
    const EP2 = "https://updates.push.services.mozilla.com/wpush/v2/two";
    mockGetPushSubscriptions.mockResolvedValueOnce([
      { endpoint: EP1, keys: { p256dh: "x", auth: "y" }, createdAt: 0n },
      { endpoint: EP2, keys: { p256dh: "x", auth: "y" }, createdAt: 0n },
      // The canister has other subs too — caller-supplied subset is fine.
      { endpoint: "https://fcm.googleapis.com/fcm/send/other", keys: { p256dh: "x", auth: "y" }, createdAt: 0n },
    ]);
    const res = await TOKEN_POST(tokenRequest({
      principal: VALID_PRINCIPAL,
      endpoints: [EP1, EP2],
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("returns 502 when canister read throws", async () => {
    mockGetPushSubscriptions.mockRejectedValueOnce(new Error("network down"));
    const res = await TOKEN_POST(tokenRequest({
      principal: VALID_PRINCIPAL,
      endpoints: [FCM_ENDPOINT],
    }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/Unable to verify/);
  });

  it("blocks the codex-finding-#11 relay attack end-to-end", async () => {
    // Attack: attacker registers an FCM endpoint for THEIR principal, then
    // calls /api/push/token claiming to be the victim. Pre-fix this minted
    // a valid token. Post-fix the canister read shows the victim never
    // registered that endpoint → 403.
    const VICTIM = "aaaaa-aa";
    const ATTACKER_ENDPOINT_FCM = "https://fcm.googleapis.com/fcm/send/attacker-server";
    mockGetPushSubscriptions.mockResolvedValueOnce([]); // victim has no subs
    const res = await TOKEN_POST(tokenRequest({
      principal: VICTIM,
      endpoints: [ATTACKER_ENDPOINT_FCM],
    }));
    expect(res.status).toBe(403);
  });
});

describe("/api/push/send — endpoint allowlist", () => {
  function validSub(endpoint = FCM_ENDPOINT) {
    return { endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } };
  }

  it("rejects (400) attacker-controlled endpoint even with a matching token", async () => {
    // Token is HMAC-valid because the route also rejects via subscription validator
    // before the token check runs. Defense in depth: both the validator and the
    // token must agree.
    const token = generatePushToken("victim", [ATTACKER_ENDPOINT]);
    const res = await SEND_POST(sendRequest({
      principal: "victim",
      subscriptions: [{ endpoint: ATTACKER_ENDPOINT, keys: { p256dh: "x", auth: "y" } }],
      token,
      title: "hi",
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid subscription shape/i);
  });

  it("accepts allowlisted FCM endpoint with a matching token", async () => {
    const principalText = "aaaaa-aa"; // management canister principal, valid for Principal.fromText
    const token = generatePushToken(principalText, [FCM_ENDPOINT]);
    const res = await SEND_POST(sendRequest({
      principal: principalText,
      subscriptions: [validSub(FCM_ENDPOINT)],
      token,
      title: "hi",
    }));
    // 200 = sent through web-push (mocked); not 4xx
    expect(res.status).toBeLessThan(400);
  });

  it("rejects allowlisted endpoint when token doesn't match (403 — auth check still applies)", async () => {
    const wrongToken = generatePushToken("attacker", [FCM_ENDPOINT]);
    const res = await SEND_POST(sendRequest({
      principal: "victim",
      subscriptions: [validSub(FCM_ENDPOINT)],
      token: wrongToken,
    }));
    expect(res.status).toBe(403);
  });
});
