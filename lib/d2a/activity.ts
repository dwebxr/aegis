import type { ContentItem } from "@/lib/types/content";

export function isD2AContent(item: ContentItem): boolean {
  return typeof item.reason === "string" && item.reason.startsWith("Received via D2A from ");
}
