/**
 * Tests for POST /api/translate.
 *
 * Hotfix 17 (+ LARP audit C1) makes translation BYOK-only at the
 * server boundary: the operator's ANTHROPIC_API_KEY env var is never
 * used for this endpoint regardless of what the client sends. These
 * tests exercise the real route handler (no route-level mocking) and
 * assert the boundary contract: requests without a valid user API key
 * get 401, requests with a valid key reach Anthropic using that key.
 */
import { POST } from "@/app/api/translate/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const originalFetch = global.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;

function makeRequest(body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/translate — BYOK enforcement (server boundary)", () => {
  beforeEach(() => {
    _resetRateLimits();
    // Ensure the operator's server key is set — the point of the tests
    // is to verify the route NEVER uses it even when present.
    process.env.ANTHROPIC_API_KEY = "sk-ant-server-operator-key-should-not-be-used";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("rejects requests with no x-user-api-key header (401)", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as jest.Mock;

    const res = await POST(makeRequest({ prompt: "Translate me." }));

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/BYOK|Anthropic API key/i);
    // Critical: must NOT have called Anthropic with the server key
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects requests with an empty x-user-api-key header (401)", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as jest.Mock;

    const res = await POST(makeRequest(
      { prompt: "Translate me." },
      { "x-user-api-key": "" },
    ));

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects requests with a non-Anthropic-prefixed key (401)", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as jest.Mock;

    const res = await POST(makeRequest(
      { prompt: "Translate me." },
      { "x-user-api-key": "sk-openai-01234" },
    ));

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects requests that look close to a valid key but lack the prefix (401)", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as jest.Mock;

    const res = await POST(makeRequest(
      { prompt: "Translate me." },
      { "x-user-api-key": "ant-abc-def" },
    ));

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a valid sk-ant-* key and forwards it to Anthropic (not the server env key)", async () => {
    const userKey = "sk-ant-user-byok-abcdef";
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: "アップルが発表しました。" }] }),
      text: async () => "",
    });
    global.fetch = fetchSpy as jest.Mock;

    const res = await POST(makeRequest(
      { prompt: "Apple announced a new product." },
      { "x-user-api-key": userKey },
    ));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.translation).toBe("アップルが発表しました。");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe(userKey);
    // The server env key is set in beforeEach — proving here that even
    // when it's available, the route never reaches for it.
    expect(init.headers["x-api-key"]).not.toBe(process.env.ANTHROPIC_API_KEY);
  });

  it("returns 400 when prompt is missing", async () => {
    const res = await POST(makeRequest(
      {},
      { "x-user-api-key": "sk-ant-valid-key" },
    ));
    expect(res.status).toBe(400);
  });

  it("returns 400 when prompt is not a string", async () => {
    const res = await POST(makeRequest(
      { prompt: { foo: "bar" } },
      { "x-user-api-key": "sk-ant-valid-key" },
    ));
    expect(res.status).toBe(400);
  });

  it("returns 502 when Anthropic returns an HTTP error", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal server error",
    }) as jest.Mock;

    const res = await POST(makeRequest(
      { prompt: "Translate me." },
      { "x-user-api-key": "sk-ant-valid-key" },
    ));

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/Claude API error/);
  });

  it("returns 502 when Anthropic returns an empty translation", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
      text: async () => "",
    }) as jest.Mock;

    const res = await POST(makeRequest(
      { prompt: "Translate me." },
      { "x-user-api-key": "sk-ant-valid-key" },
    ));

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/Empty response/);
  });

  it("truncates very long prompts to 10_000 chars before forwarding", async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: "ok" }] }),
      text: async () => "",
    });
    global.fetch = fetchSpy as jest.Mock;

    const longPrompt = "x".repeat(50_000);
    const res = await POST(makeRequest(
      { prompt: longPrompt },
      { "x-user-api-key": "sk-ant-valid-key" },
    ));
    expect(res.status).toBe(200);

    const forwardedBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(forwardedBody.messages[0].content.length).toBe(10_000);
  });

  it("rejects request even when server env key is unset — BYOK is enforced unconditionally", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as jest.Mock;

    const res = await POST(makeRequest({ prompt: "Translate me." }));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
