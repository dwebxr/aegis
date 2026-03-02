/**
 * URL utilities — extraction, validation, and SSRF protection.
 */

/** Extract first HTTP/HTTPS URL from text. Returns null if none found. */
export function extractUrl(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return trimmed;
  } catch { /* not a bare URL */ }
  const match = trimmed.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
  return match ? match[0] : null;
}

export function blockPrivateHostname(hostname: string): string | null {
  const h = hostname.toLowerCase();

  // Block localhost variants
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") {
    return "Localhost URLs are not allowed";
  }

  // Block private IP ranges (RFC 1918, RFC 6598, link-local)
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10) return "Private network URLs are not allowed";             // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return "Private network URLs are not allowed"; // 172.16.0.0/12
    if (a === 192 && b === 168) return "Private network URLs are not allowed"; // 192.168.0.0/16
    if (a === 169 && b === 254) return "Link-local URLs are not allowed";    // 169.254.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return "Private network URLs are not allowed"; // 100.64.0.0/10 (CGNAT)
    if (a === 0) return "Invalid URL target";                                // 0.0.0.0/8
  }

  // Block cloud metadata endpoints
  if (h === "metadata.google.internal" || h === "169.254.169.254") {
    return "Cloud metadata URLs are not allowed";
  }

  return null;
}

export function blockPrivateUrl(urlString: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return "Invalid URL format";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only HTTP/HTTPS URLs are allowed";
  }

  return blockPrivateHostname(parsed.hostname);
}

/**
 * Fetch with SSRF-safe redirect handling.
 * Each redirect target is validated against blockPrivateUrl before following.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const blocked = blockPrivateUrl(current);
    if (blocked) throw new Error(blocked);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).href;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

export function blockPrivateRelay(relayUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(relayUrl);
  } catch {
    return "Invalid relay URL format";
  }

  if (parsed.protocol !== "wss:") {
    return "Relay URL must use wss:// protocol";
  }

  return blockPrivateHostname(parsed.hostname);
}
