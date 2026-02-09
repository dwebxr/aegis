/**
 * SSRF protection: reject URLs pointing to private/internal networks.
 * Returns an error message if blocked, or null if allowed.
 */
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

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") {
    return "Localhost URLs are not allowed";
  }

  // Block private IP ranges (RFC 1918, RFC 6598, link-local, metadata)
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
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
  if (hostname === "metadata.google.internal" || hostname === "169.254.169.254") {
    return "Cloud metadata URLs are not allowed";
  }

  return null;
}
