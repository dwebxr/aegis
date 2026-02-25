import type { ContentItem } from "@/lib/types/content";

export function isD2AContent(item: ContentItem): boolean {
  return typeof item.reason === "string" && item.reason.startsWith("Received via D2A from ");
}

/** Extract the truncated sender pubkey from a D2A content item's reason string. */
export function extractD2ASenderPk(item: ContentItem): string | null {
  if (!item.reason) return null;
  const match = item.reason.match(/^Received via D2A from (\w+)/);
  return match ? match[1] : null;
}
