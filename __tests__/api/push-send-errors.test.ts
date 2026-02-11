import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import { Principal } from "@dfinity/principal";

const mockSendNotification = jest.fn();
jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

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

const mockFromText = jest.fn().mockReturnValue({ toText: () => "test-principal" });
jest.mock("@dfinity/principal", () => ({
  Principal: { fromText: (...args: unknown[]) => mockFromText(...args) },
}));

process.env.VAPID_PRIVATE_KEY = "test-private-key";
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";

import { POST } from "@/app/api/push/send/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/push/send — error paths", () => {
  beforeEach(() => {
    mockSendNotification.mockReset();
    mockGetPushSubscriptions.mockReset();
    mockRemovePushSubscriptions.mockReset();
    mockFromText.mockReset();
    mockFromText.mockReturnValue({ toText: () => "test-principal" });
    _resetRateLimits();
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid JSON");
  });

  it("returns 400 for invalid principal text", async () => {
    mockFromText.mockImplementation(() => { throw new Error("Invalid principal format"); });

    const res = await POST(makeRequest({ principal: "not-a-valid-principal!!!" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid principal");
  });

  it("removes subscriptions returning 404 as expired", async () => {
    mockGetPushSubscriptions.mockResolvedValue([
      { endpoint: "https://push.example.com/gone404", keys: { p256dh: "k", auth: "a" }, createdAt: BigInt(0) },
    ]);
    mockSendNotification.mockRejectedValue({ statusCode: 404 });
    mockRemovePushSubscriptions.mockResolvedValue(true);

    const res = await POST(makeRequest({ principal: "abc-123" }));
    const data = await res.json();
    expect(data.expired).toBe(1);
    expect(mockRemovePushSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("does not remove subscriptions on non-410/404 errors", async () => {
    mockGetPushSubscriptions.mockResolvedValue([
      { endpoint: "https://push.example.com/fail", keys: { p256dh: "k", auth: "a" }, createdAt: BigInt(0) },
    ]);
    mockSendNotification.mockRejectedValue({ statusCode: 500 });

    const res = await POST(makeRequest({ principal: "abc-123" }));
    const data = await res.json();
    expect(data.failed).toBe(1);
    expect(data.expired).toBe(0);
    expect(mockRemovePushSubscriptions).not.toHaveBeenCalled();
  });

  it("handles removePushSubscriptions failure gracefully", async () => {
    mockGetPushSubscriptions.mockResolvedValue([
      { endpoint: "https://push.example.com/exp", keys: { p256dh: "k", auth: "a" }, createdAt: BigInt(0) },
    ]);
    mockSendNotification.mockRejectedValue({ statusCode: 410 });
    mockRemovePushSubscriptions.mockRejectedValue(new Error("IC canister error"));

    const res = await POST(makeRequest({ principal: "abc-123" }));
    // Should still return 200 (not crash), just log the error
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.expired).toBe(1);
  });

  it("returns 500 when IC agent creation fails", async () => {
    // Override the HttpAgent.create mock to reject
    const { HttpAgent } = require("@dfinity/agent");
    HttpAgent.create.mockRejectedValueOnce(new Error("IC unreachable"));

    const res = await POST(makeRequest({ principal: "abc-123" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Failed to send");
  });

  it("returns 500 when getPushSubscriptions throws", async () => {
    mockGetPushSubscriptions.mockRejectedValue(new Error("Canister call failed"));

    const res = await POST(makeRequest({ principal: "abc-123" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Failed to send");
  });

  it("uses default url and tag when not provided", async () => {
    mockGetPushSubscriptions.mockResolvedValue([
      { endpoint: "https://push.example.com/1", keys: { p256dh: "k", auth: "a" }, createdAt: BigInt(0) },
    ]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    await POST(makeRequest({ principal: "abc-123" }));
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.url).toBe("/");
    expect(payload.tag).toBe("aegis-briefing");
  });

  it("passes custom url and tag through", async () => {
    mockGetPushSubscriptions.mockResolvedValue([
      { endpoint: "https://push.example.com/1", keys: { p256dh: "k", auth: "a" }, createdAt: BigInt(0) },
    ]);
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    await POST(makeRequest({ principal: "abc-123", url: "/briefing/123", tag: "custom-tag" }));
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.url).toBe("/briefing/123");
    expect(payload.tag).toBe("custom-tag");
  });
});
