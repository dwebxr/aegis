import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const mockSendNotification = jest.fn();
jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

const mockFromText = jest.fn().mockReturnValue({ toText: () => "test-principal" });
jest.mock("@dfinity/principal", () => ({
  Principal: { fromText: (...args: unknown[]) => mockFromText(...args) },
}));

process.env.VAPID_PRIVATE_KEY = "test-private-key";
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";

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

describe("POST /api/push/send — error paths", () => {
  beforeEach(() => {
    mockSendNotification.mockReset();
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

    const res = await POST(makeRequest(withToken("not-a-valid-principal!!!", [makeSub()])));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid principal");
  });

  it("returns 400 when an endpoint is not https", async () => {
    const res = await POST(makeRequest({
      principal: "abc-123",
      subscriptions: [{ endpoint: "http://insecure.example.com", keys: { p256dh: "k", auth: "a" } }],
      token: "anything",
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when subscriptions exceeds the cap", async () => {
    const big: InputSubscription[] = Array.from({ length: 6 }, (_, i) => makeSub(`https://push.example.com/${i}`));
    const res = await POST(makeRequest(withToken("abc-123", big)));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("exceeds limit");
  });

  it("returns expiredEndpoints for 404 responses", async () => {
    const subs = [makeSub("https://push.example.com/gone404")];
    mockSendNotification.mockRejectedValue({ statusCode: 404 });

    const res = await POST(makeRequest(withToken("abc-123", subs)));
    const data = await res.json();
    expect(data.expiredEndpoints).toEqual(["https://push.example.com/gone404"]);
  });

  it("does not mark non-410/404 errors as expired", async () => {
    const subs = [makeSub("https://push.example.com/fail")];
    mockSendNotification.mockRejectedValue({ statusCode: 500 });

    const res = await POST(makeRequest(withToken("abc-123", subs)));
    const data = await res.json();
    expect(data.failed).toBe(1);
    expect(data.expiredEndpoints).toEqual([]);
  });

  it("uses default url and tag when not provided", async () => {
    const subs = [makeSub()];
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    await POST(makeRequest(withToken("abc-123", subs)));
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.url).toBe("/");
    expect(payload.tag).toBe("aegis-briefing");
  });

  it("passes custom url and tag through", async () => {
    const subs = [makeSub()];
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    await POST(makeRequest(withToken("abc-123", subs, { url: "/briefing/123", tag: "custom-tag" })));
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.url).toBe("/briefing/123");
    expect(payload.tag).toBe("custom-tag");
  });
});
