import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "https://4wfup-gqaaa-aaaas-qdqca-cai.icp0.io",
  "https://aegis.dwebxr.xyz",
];

function corsHeaders(origin?: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-PAYMENT, PAYMENT-SIGNATURE",
    "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-REQUIRED, X-PAYMENT-RESPONSE",
    "Access-Control-Max-Age": "86400",
  };
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
