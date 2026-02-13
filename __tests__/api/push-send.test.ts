import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

// Mock web-push
const mockSendNotification = jest.fn();
jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

// Mock @dfinity/agent
const mockGetPushSubscriptions = jest.fn();
const mockRemovePushSubscriptions = jest.fn();
jest.mock("@dfinity/agent", () => ({
  HttpAgent: { create: jest.fn().mockResolvedValue({}) },
  Actor: {
    createActor: jest.fn().mockReturnValue({
      getPushSubscriptions: (...args: unknown[]) => mockGetPushSubscriptions(...args),
      removePushSubscriptions: (...args: unknown[]) => mockRemovePushSubscriptions(...args),
    }),
  },
}));

jest.mock("@dfinity/principal", () => ({
  Principal: { fromText: jest.fn().mockReturnValue({ toText: () => "test-principal" }) },
}));

// Set env before importing route
process.env.VAPID_PRIVATE_KEY = "test-private-key";
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_SUBJECT = "mailto:test@example.com";

import { POST } from "@/app/api/push/send/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/push/send", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetRateLimits();
  });

  it("returns 400 when principal is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("principal required");
  });

  it("returns 0 sent when no subscriptions exist", async () => {
    mockGetPushSubscriptions.mockResolvedValue([]);
    const res = await POST(makeRequest({ principal: "abc-123" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sent).toBe(0);
  });

  it("sends notifications to subscriptions", async () => {
    mockGetPushSubscriptions.mockResolvedValue([
      { endpoint: "https://push.example.com/1", keys: { p256dh: "key1", auth: "auth1" }, createdAt: BigInt(0) },
      { endpoint: "https://push.example.com/2", keys: { p256dh: "key2", auth: "auth2" }, createdAt: BigInt(0) },
    ]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    const res = await POST(makeRequest({ principal: "abc-123", title: "Test", body: "Hello" }));
    const data = await res.json();
    expect(data.sent).toBe(2);
    expect(data.failed).toBe(0);
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });

  it("removes expired subscriptions (410 Gone)", async () => {
    mockGetPushSubscriptions.mockResolvedValue([
      { endpoint: "https://push.example.com/expired", keys: { p256dh: "k", auth: "a" }, createdAt: BigInt(0) },
    ]);
    mockSendNotification.mockRejectedValue({ statusCode: 410 });
    mockRemovePushSubscriptions.mockResolvedValue(true);

    const res = await POST(makeRequest({ principal: "abc-123" }));
    const data = await res.json();
    expect(data.sent).toBe(0);
    expect(data.failed).toBe(1);
    expect(data.expired).toBe(1);
    expect(data.cleanupFailed).toBe(false);
    expect(mockRemovePushSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("rate limits after 5 requests", async () => {
    mockGetPushSubscriptions.mockResolvedValue([]);
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ principal: "abc-123" }));
      expect(res.status).toBe(200);
    }
    const res = await POST(makeRequest({ principal: "abc-123" }));
    expect(res.status).toBe(429);
  });

  it("uses default title and body when not provided", async () => {
    mockGetPushSubscriptions.mockResolvedValue([
      { endpoint: "https://push.example.com/1", keys: { p256dh: "k", auth: "a" }, createdAt: BigInt(0) },
    ]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    await POST(makeRequest({ principal: "abc-123" }));
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.title).toBe("Aegis Briefing");
    expect(payload.body).toBe("Your new briefing is ready.");
  });
});
