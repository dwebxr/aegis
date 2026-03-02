import type { ContentItem } from "@/lib/types/content";
import { contentToCSV } from "@/lib/utils/csv";

export type ExportPeriod = "today" | "7d" | "30d" | "all";
export type ExportType = "quality" | "all";

export interface ExportScope {
  period: ExportPeriod;
  type: ExportType;
}

export function downloadFile(data: string, filename: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function filterByScope(items: ContentItem[], scope: ExportScope): ContentItem[] {
  let filtered = items;

  if (scope.type === "quality") {
    filtered = filtered.filter(c => c.verdict === "quality");
  }

  if (scope.period !== "all") {
    const now = Date.now();
    const cutoff: Record<Exclude<ExportPeriod, "all">, number> = {
      today: now - 24 * 60 * 60 * 1000,
      "7d": now - 7 * 24 * 60 * 60 * 1000,
      "30d": now - 30 * 24 * 60 * 60 * 1000,
    };
    const cutoffMs = cutoff[scope.period];
    filtered = filtered.filter(c => c.createdAt >= cutoffMs);
  }

  return filtered;
}

export function exportContentCSV(content: ContentItem[], scope: ExportScope = { period: "all", type: "all" }) {
  const filtered = filterByScope(content, scope);
  downloadFile(
    contentToCSV(filtered),
    `aegis-evaluations-${new Date().toISOString().slice(0, 10)}.csv`,
    "text/csv",
  );
}

export function exportContentJSON(content: ContentItem[], scope: ExportScope = { period: "all", type: "all" }) {
  const filtered = filterByScope(content, scope);
  const data = filtered.map(c => ({
    id: c.id, author: c.author, source: c.source, verdict: c.verdict,
    scores: c.scores, vSignal: c.vSignal, cContext: c.cContext, lSlop: c.lSlop,
    topics: c.topics, text: c.text, reason: c.reason,
    createdAt: new Date(c.createdAt).toISOString(),
    validatedAt: c.validatedAt ? new Date(c.validatedAt).toISOString() : null,
    sourceUrl: c.sourceUrl,
  }));
  downloadFile(
    JSON.stringify(data, null, 2),
    `aegis-evaluations-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json",
  );
}
