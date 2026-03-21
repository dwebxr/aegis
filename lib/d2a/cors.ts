import { NextRequest, NextResponse } from "next/server";
import { APP_URL } from "@/lib/config";

function isValidOrigin(o: string): boolean {
  try {
    const url = new URL(o);
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:" && url.hostname === "localhost") return true;
    return false;
  } catch { return false; }
}

function csvEnv(key: string): string[] {
  const val = process.env[key];
  return val ? val.split(",").map(o => o.trim()).filter(Boolean) : [];
}

const ALLOWED_ORIGINS: string[] = [
  ...(process.env.D2A_CORS_ORIGINS
    ? csvEnv("D2A_CORS_ORIGINS")
    : ["https://4wfup-gqaaa-aaaas-qdqca-cai.icp0.io", APP_URL]),
  ...csvEnv("AEGIS_A2A_ALLOWED_ORIGINS"),
].filter(isValidOrigin);

const STATIC_CORS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-PAYMENT, PAYMENT-SIGNATURE",
  "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-REQUIRED, X-PAYMENT-RESPONSE",
  "Access-Control-Max-Age": "86400",
};

function corsHeaders(origin?: string | null): Record<string, string> {
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { ...STATIC_CORS, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return STATIC_CORS;
}

export function corsOptionsResponse(request: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export function withCors(response: NextResponse, origin?: string | null): NextResponse {
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    response.headers.set(key, value);
  }
  return response;
}
