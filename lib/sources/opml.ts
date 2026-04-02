import type { SavedSource } from "@/lib/types/sources";

const MAX_XML_BYTES = 1_048_576; // 1 MB
const MAX_OUTLINES = 500;
const MAX_URL_LENGTH = 2048;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sourcesToOpml(sources: SavedSource[]): string {
  const rssFeeds = sources.filter(
    (s) => s.type === "rss" && s.feedUrl,
  );

  const groups = new Map<string, SavedSource[]>();
  for (const s of rssFeeds) {
    const folder = s.platform ?? "General";
    const list = groups.get(folder);
    if (list) {
      list.push(s);
    } else {
      groups.set(folder, [s]);
    }
  }

  let body = "";
  for (const [folder, items] of groups) {
    body += `      <outline text="${escapeXml(folder)}">\n`;
    for (const s of items) {
      const label = escapeXml(s.label);
      const url = escapeXml(s.feedUrl!);
      body += `        <outline text="${label}" title="${label}" xmlUrl="${url}" type="rss"/>\n`;
    }
    body += `      </outline>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Aegis OPML Export</title>
  </head>
  <body>
${body}  </body>
</opml>
`;
}

function collectOutlines(
  element: Element,
  results: SavedSource[],
  seen: Set<string>,
): void {
  const children = element.children;
  for (let i = 0; i < children.length; i++) {
    if (results.length >= MAX_OUTLINES) return;

    const el = children[i];
    if (el.tagName.toLowerCase() !== "outline") continue;

    const xmlUrl = el.getAttribute("xmlUrl") ?? el.getAttribute("xmlurl");
    if (xmlUrl) {
      if (xmlUrl.length > MAX_URL_LENGTH) continue;
      if (!/^https?:\/\//i.test(xmlUrl)) continue;
      if (seen.has(xmlUrl)) continue;
      seen.add(xmlUrl);

      const text = el.getAttribute("text") ?? "";
      const title = el.getAttribute("title") ?? "";
      const label = text || title || xmlUrl;

      results.push({
        id: `rss:${xmlUrl}`,
        type: "rss",
        label,
        feedUrl: xmlUrl,
        enabled: true,
        createdAt: Date.now(),
      });
    } else {
      collectOutlines(el, results, seen);
    }
  }
}

export function opmlToSources(xml: string): SavedSource[] {
  if (!xml || xml.length > MAX_XML_BYTES) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  if (doc.querySelector("parsererror")) return [];

  const body = doc.querySelector("body");
  if (!body) return [];

  const results: SavedSource[] = [];
  const seen = new Set<string>();
  collectOutlines(body, results, seen);

  return results;
}
