import { NextRequest, NextResponse } from "next/server";
import { rateLimit, checkBodySize } from "@/lib/api/rateLimit";
import { errMsg } from "@/lib/utils/errors";

export const maxDuration = 30;

const HUB_URL = "https://hub.pinata.cloud";
const FETCH_TIMEOUT = 10_000;

interface CastAddBody {
  text: string;
  embeds?: Array<{ url?: string }>;
  parentUrl?: string;
}

interface HubMessage {
  data: {
    type: string;
    fid: number;
    timestamp: number;
    castAddBody?: CastAddBody;
  };
  hash: string;
}

interface UserDataMessage {
  data: {
    fid: number;
    userDataBody: { type: string; value: string };
  };
}

async function hubFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${HUB_URL}${path}`, {
    headers: { "User-Agent": "Aegis/2.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hub API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function resolveUsername(username: string): Promise<{ fid: number }> {
  const data = await hubFetch<{ fid: number }>(
    `/v1/userNameProofByName?name=${encodeURIComponent(username)}`,
  );
  if (!data.fid || typeof data.fid !== "number") {
    throw new Error("FID not found in response");
  }
  return { fid: data.fid };
}

async function getUserProfile(fid: number): Promise<{ displayName?: string; pfpUrl?: string; username?: string }> {
  const profile: { displayName?: string; pfpUrl?: string; username?: string } = {};
  try {
    const data = await hubFetch<{ messages: UserDataMessage[] }>(
      `/v1/userDataByFid?fid=${fid}`,
    );
    for (const msg of data.messages || []) {
      const { type, value } = msg.data.userDataBody;
      if (type === "USER_DATA_TYPE_DISPLAY" && value) profile.displayName = value;
      else if (type === "USER_DATA_TYPE_PFP" && value) profile.pfpUrl = value;
      else if (type === "USER_DATA_TYPE_USERNAME" && value) profile.username = value;
    }
  } catch (err) {
    console.warn("[fetch/farcaster] Profile fetch failed (best-effort):", errMsg(err));
  }
  return profile;
}

const IMAGE_CDN_HOSTS = [
  "imagedelivery.net",
  "i.imgur.com",
  "res.cloudinary.com",
  "pbs.twimg.com",
  "media.tenor.com",
];

function extractImageUrl(embeds?: Array<{ url?: string }>): string | undefined {
  if (!embeds) return undefined;
  for (const embed of embeds) {
    if (!embed.url) continue;
    if (/\.(jpg|jpeg|png|gif|webp|svg|avif)(\?|$)/i.test(embed.url)) return embed.url;
    try {
      const host = new URL(embed.url).hostname;
      if (IMAGE_CDN_HOSTS.some(cdn => host === cdn || host.endsWith("." + cdn))) return embed.url;
    } catch { /* ignore malformed URLs */ }
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 20, 60_000);
  if (limited) return limited;
  const tooLarge = checkBodySize(request);
  if (tooLarge) return tooLarge;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action } = body;

  if (action === "resolve") {
    const { username } = body;
    if (!username || typeof username !== "string" || username.length > 30) {
      return NextResponse.json({ error: "Valid username is required" }, { status: 400 });
    }

    try {
      const { fid } = await resolveUsername(username);
      const profile = await getUserProfile(fid);
      return NextResponse.json({
        fid,
        displayName: profile.displayName,
        pfpUrl: profile.pfpUrl,
        username: profile.username || username,
      });
    } catch (err) {
      const msg = errMsg(err);
      console.error("[fetch/farcaster] Resolve failed:", msg);
      if (msg.includes("404") || msg.includes("not found")) {
        return NextResponse.json({ error: `User "${username}" not found on Farcaster` }, { status: 404 });
      }
      return NextResponse.json({ error: `Failed to resolve user: ${msg}` }, { status: 502 });
    }
  }

  if (action === "feed") {
    const { fid, limit = 20 } = body;
    if (!fid || typeof fid !== "number" || fid <= 0) {
      return NextResponse.json({ error: "Valid fid (positive number) is required" }, { status: 400 });
    }

    const pageSize = Math.min(Math.max(1, limit), 50);

    try {
      const profile = await getUserProfile(fid);
      const data = await hubFetch<{ messages: HubMessage[] }>(
        `/v1/castsByFid?fid=${fid}&pageSize=${pageSize}&reverse=true`,
      );

      const displayName = profile.displayName || profile.username || `fid:${fid}`;

      const items = (data.messages || [])
        .filter(m => m.data.type === "MESSAGE_TYPE_CAST_ADD" && m.data.castAddBody)
        .map(m => {
          const cast = m.data.castAddBody!;
          const hash = m.hash.startsWith("0x") ? m.hash.slice(0, 10) : "0x" + m.hash.slice(0, 8);
          return {
            text: cast.text,
            author: displayName,
            avatar: profile.pfpUrl,
            sourceUrl: `https://warpcast.com/${profile.username || `~/fid:${fid}`}/${hash}`,
            imageUrl: extractImageUrl(cast.embeds),
            timestamp: m.data.timestamp,
          };
        });

      return NextResponse.json({
        items,
        feedTitle: `@${profile.username || fid} on Farcaster`,
      });
    } catch (err) {
      const msg = errMsg(err);
      console.error("[fetch/farcaster] Feed fetch failed:", msg);
      if (msg.includes("timeout")) {
        return NextResponse.json({ items: [], warning: "Request timed out" });
      }
      return NextResponse.json({ error: `Failed to fetch casts: ${msg}` }, { status: 502 });
    }
  }

  return NextResponse.json(
    { error: "Invalid action. Use 'resolve' or 'feed'" },
    { status: 400 },
  );
}
