import type { ContentItem } from "@/lib/types/content";

export function csvEscape(s: string): string {
  // Neutralize spreadsheet formula/DDE injection: Excel/Sheets/LibreOffice treat a
  // cell starting with = + - @ (or a leading tab/CR) as a formula. author/text/etc.
  // come from untrusted feeds, so prefix a single quote to force literal text.
  const defused = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  const escaped = defused.replace(/"/g, '""');
  return /[,"\n\r]/.test(defused) ? `"${escaped}"` : escaped;
}

export function contentToCSV(items: ContentItem[]): string {
  const header = "id,author,source,verdict,composite,originality,insight,credibility,vSignal,cContext,lSlop,topics,text,reason,createdAt,validatedAt,sourceUrl";
  const rows = items.map(c => [
    c.id, csvEscape(c.author), c.source, c.verdict,
    c.scores.composite, c.scores.originality, c.scores.insight, c.scores.credibility,
    c.vSignal ?? "", c.cContext ?? "", c.lSlop ?? "",
    csvEscape((c.topics || []).join(";")),
    csvEscape(c.text || ""), csvEscape(c.reason || ""),
    new Date(c.createdAt).toISOString(),
    c.validatedAt ? new Date(c.validatedAt).toISOString() : "",
    csvEscape(c.sourceUrl || ""),
  ].join(","));
  return [header, ...rows].join("\n");
}
