// Strip RSS-supplied link values that aren't http(s) — defends against
// `javascript:` and similar URI schemes being rendered into clickable anchors.
export function safeRssLink(link: unknown): string {
  if (typeof link !== "string" || link.length === 0) return "";
  try {
    const u = new URL(link);
    return u.protocol === "http:" || u.protocol === "https:" ? link : "";
  } catch {
    return "";
  }
}
