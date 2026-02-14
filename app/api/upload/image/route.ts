import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";

export const maxDuration = 30;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 10, 60_000);
  if (limited) return limited;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}. Use JPEG, PNG, GIF, or WebP.` }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 5MB.` }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append("file", file);

  const headers: Record<string, string> = {};
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  let res: Response;
  try {
    res = await fetch("https://nostr.build/api/v2/upload/files", {
      method: "POST",
      headers,
      body: upstream,
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    console.error("[upload/image] nostr.build fetch failed:", err);
    return NextResponse.json({ error: "Image host unreachable" }, { status: 502 });
  }

  if (!res.ok) {
    console.error("[upload/image] nostr.build returned", res.status);
    return NextResponse.json({ error: `Image host error: ${res.status}` }, { status: 502 });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json({ error: "Invalid response from image host" }, { status: 502 });
  }

  const url = data?.data?.[0]?.url;
  if (typeof url !== "string") {
    console.error("[upload/image] Unexpected response shape:", JSON.stringify(data).slice(0, 200));
    return NextResponse.json({ error: "No URL in image host response" }, { status: 502 });
  }

  return NextResponse.json({ url });
}
