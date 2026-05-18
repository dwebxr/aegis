/**
 * parseJsonBody post-read body cap.
 *
 * Codex finding #10: checkBodySize trusts the Content-Length header. A request
 * with no Content-Length, or a chunked transfer-encoding body, could bypass
 * the pre-read check and reach `request.json()` unbounded. The fix is to
 * consume the body as bytes and re-check against `maxBytes` before parsing.
 */
import { parseJsonBody, guardAndParse, _resetRateLimits } from "@/lib/api/rateLimit";
import { NextRequest } from "next/server";

function makeRequest(opts: {
  body: string;
  contentLength?: string;
  noContentLength?: boolean;
  ip?: string;
}): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  if (opts.contentLength !== undefined) headers["content-length"] = opts.contentLength;
  const req = new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers,
    body: opts.body,
  });
  if (opts.noContentLength) {
    req.headers.delete("content-length");
  }
  return req;
}

beforeEach(() => {
  _resetRateLimits();
});

describe("parseJsonBody — body size cap", () => {
  it("parses valid JSON within the default cap", async () => {
    const req = makeRequest({ body: JSON.stringify({ ok: true }) });
    const result = await parseJsonBody<{ ok: boolean }>(req);
    expect(result.error).toBeUndefined();
    expect(result.body).toEqual({ ok: true });
  });

  it("rejects body over the default 512KB cap", async () => {
    // 600KB JSON string — well past default 512KB. No Content-Length needed:
    // post-read cap is the only guarantee.
    const big = JSON.stringify({ s: "x".repeat(600_000) });
    const req = makeRequest({ body: big, noContentLength: true });
    const result = await parseJsonBody(req);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(413);
  });

  it("rejects body over a custom cap (1KB)", async () => {
    const body = JSON.stringify({ data: "x".repeat(2_000) });
    const req = makeRequest({ body, noContentLength: true });
    const result = await parseJsonBody(req, 1_024);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(413);
  });

  it("accepts body exactly at the cap boundary", async () => {
    // Body engineered to be exactly `cap` bytes.
    const cap = 100;
    const padded = `{"d":"${"x".repeat(cap - 8)}"}`; // {"d":"..."} = 8 chars overhead
    expect(padded.length).toBe(cap);
    const req = makeRequest({ body: padded });
    const result = await parseJsonBody(req, cap);
    expect(result.error).toBeUndefined();
    expect(result.body).toEqual({ d: "x".repeat(cap - 8) });
  });

  it("rejects body 1 byte over the cap", async () => {
    const cap = 100;
    const oversized = `{"d":"${"x".repeat(cap - 7)}"}`; // 1 byte over
    expect(oversized.length).toBe(cap + 1);
    const req = makeRequest({ body: oversized });
    const result = await parseJsonBody(req, cap);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(413);
  });

  it("rejects invalid JSON with 400 (not 413)", async () => {
    const req = makeRequest({ body: "{not valid json" });
    const result = await parseJsonBody(req);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(400);
  });

  it("rejects when Content-Length lies (header understates actual size)", async () => {
    // Attacker advertises a small Content-Length but sends a much larger body.
    // checkBodySize trusts the header so passes; parseJsonBody catches it on
    // the real byte count.
    const body = JSON.stringify({ s: "x".repeat(600_000) });
    const req = makeRequest({ body, contentLength: "100" });
    const result = await parseJsonBody(req, 512_000);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(413);
  });

  it("handles unicode at byte boundaries (counts bytes, not chars)", async () => {
    // 3-byte UTF-8 chars: '日' = 3 bytes. Need to think in bytes, not chars.
    const text = "日".repeat(50); // 150 bytes
    const body = JSON.stringify({ t: text });
    const req = makeRequest({ body });
    const result = await parseJsonBody<{ t: string }>(req, 200);
    expect(result.body?.t).toBe(text);
  });

  it("rejects unicode body that exceeds byte cap even when char count is small", async () => {
    const text = "🌍".repeat(100); // surrogate pair, ~4 bytes per emoji = ~400 bytes
    const body = JSON.stringify({ t: text });
    const req = makeRequest({ body });
    const result = await parseJsonBody(req, 200);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(413);
  });

  it("handles empty body as invalid JSON (not as too-large)", async () => {
    const req = makeRequest({ body: "" });
    const result = await parseJsonBody(req);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(400);
  });
});

describe("guardAndParse — propagates body cap correctly", () => {
  it("rejects oversized body with 413 even with rate-limit headroom", async () => {
    const body = JSON.stringify({ s: "x".repeat(100_000) });
    const req = makeRequest({ body, ip: "10.0.0.99", noContentLength: true });
    const result = await guardAndParse(req, { maxBytes: 50_000 });
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(413);
  });

  it("custom maxBytes flows through to parseJsonBody (not just checkBodySize)", async () => {
    // Spoofed Content-Length under cap; actual body well over.
    const body = JSON.stringify({ s: "x".repeat(20_000) });
    const req = makeRequest({ body, contentLength: "100", ip: "10.0.0.98" });
    const result = await guardAndParse(req, { maxBytes: 5_000 });
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(413);
  });
});
