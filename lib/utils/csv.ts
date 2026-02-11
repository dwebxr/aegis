import type { ContentItem } from "@/lib/types/content";

export function csvEscape(s: string): string {
  const escaped = s.replace(/"/g, '""');
  return /[,"\n\r]/.test(s) ? `"${escaped}"` : escaped;
}

export function contentToCSV(items: ContentItem[]): string {
  const header = "id,author,source,verdict,composite,originality,insight,credibility,vSignal,cContext,lSlop,topics,text,reason,createdAt,sourceUrl";
  const rows = items.map(c => [
    c.id, csvEscape(c.author), c.source, c.verdict,
    c.scores.composite, c.scores.originality, c.scores.insight, c.scores.credibility,
    c.vSignal ?? "", c.cContext ?? "", c.lSlop ?? "",
    csvEscape((c.topics || []).join(";")),
    csvEscape(c.text || ""), csvEscape(c.reason || ""),
    new Date(c.createdAt).toISOString(), csvEscape(c.sourceUrl || ""),
  ].join(","));
  return [header, ...rows].join("\n");
}
