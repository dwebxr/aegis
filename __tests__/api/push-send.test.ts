import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const mockSendNotification = jest.fn();
jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

jest.mock("@dfinity/principal", () => ({
  Principal: { fromText: jest.fn().mockReturnValue({ toText: () => "test-principal" }) },
}));

// Set env before importing route
process.env.VAPID_PRIVATE_KEY = "test-private-key";
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_SUBJECT = "mailto:test@example.com";

import { POST } from "@/app/api/push/send/route";
import { generatePushToken } from "@/lib/api/pushToken";

interface InputSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function makeSub(endpoint = "https://push.example.com/1"): InputSubscription {
  return { endpoint, keys: { p256dh: "k", auth: "a" } };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Builds a request body with a token bound to (principal, endpoints). */
function withToken(
  principal: string,
  subscriptions: InputSubscription[],
  extra: Record<string, unknown> = {},
) {
  const endpoints = subscriptions.map(s => s.endpoint);
  return {
    principal,
    subscriptions,
    token: generatePushToken(principal, endpoints),
    ...extra,
  };
}

describe("POST /api/push/send", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetRateLimits();
  });

  it("returns 400 when principal is missing", async () => {
    const res = await POST(makeRequest({ subscriptions: [makeSub()] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("principal required");
  });

  it("returns 400 when subscriptions is missing", async () => {
    const res = await POST(makeRequest({ principal: "abc-123" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("subscriptions");
  });

  it("returns 400 when subscriptions is empty", async () => {
    const res = await POST(makeRequest({ principal: "abc-123", subscriptions: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid subscription shape", async () => {
    const res = await POST(makeRequest({
      principal: "abc-123",
      subscriptions: [{ endpoint: "https://push.example.com/x" }],
      token: "anything",
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("invalid subscription shape");
  });

  it("returns 403 when token is missing", async () => {
    const res = await POST(makeRequest({ principal: "abc-123", subscriptions: [makeSub()] }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("token");
  });

  it("returns 403 when token is invalid", async () => {
    const res = await POST(makeRequest({
      principal: "abc-123",
      subscriptions: [makeSub()],
      token: "wrong-token",
    }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when token was issued for a different endpoint set", async () => {
    const tokenForA = generatePushToken("abc-123", ["https://push.example.com/A"]);
    const res = await POST(makeRequest({
      principal: "abc-123",
      subscriptions: [makeSub("https://push.example.com/B")],
      token: tokenForA,
    }));
    expect(res.status).toBe(403);
  });

  it("sends notifications to provided subscriptions", async () => {
    mockSendNotification.mockResolvedValue({ statusCode: 201 });
    const subs = [
      { endpoint: "https://push.example.com/1", keys: { p256dh: "key1", auth: "auth1" } },
      { endpoint: "https://push.example.com/2", keys: { p256dh: "key2", auth: "auth2" } },
    ];

    const res = await POST(makeRequest(withToken("abc-123", subs, { title: "Test", body: "Hello" })));
    const data = await res.json();
    expect(data.sent).toBe(2);
    expect(data.failed).toBe(0);
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });

  it("returns expiredEndpoints for 410 Gone responses", async () => {
    const subs = [makeSub("https://push.example.com/expired")];
    mockSendNotification.mockRejectedValue({ statusCode: 410 });

    const res = await POST(makeRequest(withToken("abc-123", subs)));
    const data = await res.json();
    expect(data.sent).toBe(0);
    expect(data.failed).toBe(1);
    expect(data.expiredEndpoints).toEqual(["https://push.example.com/expired"]);
  });

  it("rate limits after 5 requests", async () => {
    mockSendNotification.mockResolvedValue({ statusCode: 201 });
    const subs = [makeSub()];
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest(withToken("abc-123", subs)));
      expect(res.status).toBe(200);
    }
    const res = await POST(makeRequest(withToken("abc-123", subs)));
    expect(res.status).toBe(429);
  });

  it("uses default title and body when not provided", async () => {
    mockSendNotification.mockResolvedValue({ statusCode: 201 });
    const subs = [makeSub()];
    await POST(makeRequest(withToken("abc-123", subs)));
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.title).toBe("Aegis Briefing");
    expect(payload.body).toBe("Your new briefing is ready.");
  });

  it("generatePushToken is deterministic for the same (principal, endpoints)", () => {
    const t1 = generatePushToken("abc", ["https://e/1", "https://e/2"]);
    const t2 = generatePushToken("abc", ["https://e/1", "https://e/2"]);
    expect(t1).toBe(t2);
    expect(t1.length).toBe(32);
  });

  it("generatePushToken is endpoint-order-independent", () => {
    const a = generatePushToken("abc", ["https://e/1", "https://e/2"]);
    const b = generatePushToken("abc", ["https://e/2", "https://e/1"]);
    expect(a).toBe(b);
  });

  it("generatePushToken differs by principal", () => {
    expect(generatePushToken("alice", ["https://e/1"]))
      .not.toBe(generatePushToken("bob", ["https://e/1"]));
  });

  it("generatePushToken differs by endpoint set", () => {
    expect(generatePushToken("alice", ["https://e/1"]))
      .not.toBe(generatePushToken("alice", ["https://e/1", "https://e/2"]));
  });
});
