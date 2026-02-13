import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import { NextRequest, NextResponse } from "next/server";

function makeRequest(origin?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  return new NextRequest("http://localhost/api/d2a/info", { method: "GET", headers });
}

describe("corsOptionsResponse", () => {
  it("returns 204 with no body", () => {
    const res = corsOptionsResponse(makeRequest());
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("omits Access-Control-Allow-Origin when no origin header", () => {
    const res = corsOptionsResponse(makeRequest());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("omits Access-Control-Allow-Origin for unknown origins", () => {
    const res = corsOptionsResponse(makeRequest("https://evil.example.com"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("reflects allowed origin: aegis.dwebxr.xyz", () => {
    const res = corsOptionsResponse(makeRequest("https://aegis.dwebxr.xyz"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
  });

  it("reflects allowed origin: ICP canister", () => {
    const res = corsOptionsResponse(makeRequest("https://4wfup-gqaaa-aaaas-qdqca-cai.icp0.io"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://4wfup-gqaaa-aaaas-qdqca-cai.icp0.io");
  });

  it("sets Vary: Origin for allowed origins", () => {
    const res = corsOptionsResponse(makeRequest("https://aegis.dwebxr.xyz"));
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("includes GET and OPTIONS methods", () => {
    const res = corsOptionsResponse(makeRequest());
    const methods = res.headers.get("Access-Control-Allow-Methods")!;
    expect(methods).toContain("GET");
    expect(methods).toContain("OPTIONS");
  });

  it("allows x402 payment headers", () => {
    const res = corsOptionsResponse(makeRequest());
    const allowHeaders = res.headers.get("Access-Control-Allow-Headers")!;
    expect(allowHeaders).toContain("X-PAYMENT");
    expect(allowHeaders).toContain("PAYMENT-SIGNATURE");
    expect(allowHeaders).toContain("Authorization");
  });

  it("exposes x402 response headers", () => {
    const res = corsOptionsResponse(makeRequest());
    const exposed = res.headers.get("Access-Control-Expose-Headers")!;
    expect(exposed).toContain("PAYMENT-REQUIRED");
    expect(exposed).toContain("PAYMENT-RESPONSE");
    expect(exposed).toContain("X-PAYMENT-REQUIRED");
    expect(exposed).toContain("X-PAYMENT-RESPONSE");
  });

  it("sets max-age to 86400 (24h)", () => {
    const res = corsOptionsResponse(makeRequest());
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
  });
});

describe("withCors", () => {
  it("adds CORS headers to an existing response for allowed origin", () => {
    const response = NextResponse.json({ ok: true });
    const result = withCors(response, "https://aegis.dwebxr.xyz");
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
    expect(result.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("omits Access-Control-Allow-Origin for null origin", () => {
    const response = NextResponse.json({ ok: true });
    const result = withCors(response, null);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("preserves existing response body", async () => {
    const response = NextResponse.json({ data: "hello" });
    const result = withCors(response, null);
    const data = await result.json();
    expect(data.data).toBe("hello");
  });

  it("preserves existing response status", () => {
    const response = NextResponse.json({ error: "not found" }, { status: 404 });
    const result = withCors(response, null);
    expect(result.status).toBe(404);
  });

  it("reflects allowed origin when provided", () => {
    const response = NextResponse.json({ ok: true });
    const result = withCors(response, "https://aegis.dwebxr.xyz");
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe("https://aegis.dwebxr.xyz");
  });

  it("omits Access-Control-Allow-Origin for unknown origin", () => {
    const response = NextResponse.json({ ok: true });
    const result = withCors(response, "https://random.example.com");
    expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("omits Access-Control-Allow-Origin when origin is undefined", () => {
    const response = NextResponse.json({ ok: true });
    const result = withCors(response, undefined);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("returns the same response object (mutated, not cloned)", () => {
    const response = NextResponse.json({ ok: true });
    const result = withCors(response, null);
    expect(result).toBe(response);
  });
});
