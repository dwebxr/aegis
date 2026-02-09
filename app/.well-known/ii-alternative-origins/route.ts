import { NextResponse } from "next/server";

const body = { alternativeOrigins: ["https://aegis.dwebxr.xyz"] };

export function GET() {
  return NextResponse.json(body, {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
