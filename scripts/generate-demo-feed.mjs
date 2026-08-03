import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Parser from "rss-parser";

/**
 * Regenerates public/demo-feed.json — the static snapshot the anonymous demo
 * renders from.
 *
 * The demo used to run the live ingestion pipeline in the visitor's browser,
 * which meant every anonymous visit invoked /api/fetch/rss and /api/fetch/url on
 * the server. Serving a committed snapshot from the CDN instead makes the demo
 * cost zero server CPU. Scoring is deliberately NOT baked in: the browser still
 * runs the real heuristic scorer over these items, so the demo shows live
 * pipeline output over frozen input.
 *
 * Feed list mirrors lib/demo/sources.ts (the source of truth — __tests__ assert
 * the snapshot only contains feeds listed there). Item shape mirrors the
 * `buildItems` mapping in app/api/fetch/rss/route.ts closely enough for display;
 * exact parity is not required because nothing downstream re-parses it.
 *
 * Usage: node scripts/generate-demo-feed.mjs
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const OUT = path.join(root, "public", "demo-feed.json");

const FEEDS = [
  { feedUrl: "https://hnrss.org/frontpage", label: "Hacker News" },
  { feedUrl: "https://www.coindesk.com/arc/outboundfeeds/rss/", label: "CoinDesk" },
  { feedUrl: "https://www.theverge.com/rss/index.xml", label: "The Verge" },
];

/** Items per feed. Matches MAX_ITEMS_PER_SOURCE in lib/ingestion/scheduler.ts. */
const ITEMS_PER_FEED = 5;
/** Matches MAX_TEXT_LENGTH in lib/ingestion/fetchers.ts. */
const MAX_TEXT_LENGTH = 2000;

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "Aegis/2.0 Content Quality Filter",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
  },
  // Same custom fields the /api/fetch/rss route declares, so thumbnails survive.
  customFields: {
    item: [
      ["media:thumbnail", "media:thumbnail", { keepArray: false }],
      ["media:content", "media:content", { keepArray: false }],
    ],
  },
});

/** Feeds escape attribute values, so `&amp;`/`&#038;` reach us inside URLs. */
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&(?:amp|#0*38);/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#0*39;/g, "'");
}

/**
 * Strips tags and collapses whitespace like lib/utils/text.ts stripHtmlToText,
 * and additionally decodes the common entities. Production does not decode —
 * it re-reads the feed every cycle and any oddity is transient — but this
 * snapshot is frozen until someone regenerates it, so it is worth cleaning.
 */
function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Only http(s) links are kept — same rule as app/api/fetch/rss/safeRssLink.ts. */
function safeLink(link) {
  if (typeof link !== "string") return undefined;
  try {
    const u = new URL(decodeEntities(link));
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Thumbnail, mirroring extractImage in app/api/fetch/rss/route.ts. Without it
 * the demo renders text-only cards, which is not what the live pipeline shows.
 */
function extractImage(item, rawContent) {
  if (item.enclosure?.url && /image/i.test(item.enclosure.type || "")) {
    return safeLink(item.enclosure.url);
  }
  const media = item["media:thumbnail"] || item["media:content"];
  const url = typeof media === "string" ? media : media?.$?.url;
  if (typeof url === "string") return safeLink(url);
  const inline = String(rawContent).match(/<img[^>]+src=["']([^"']+)["']/i);
  return inline?.[1] ? safeLink(inline[1]) : undefined;
}

/**
 * Fetches the article page and reads its og:image / twitter:image.
 *
 * Baked in here so the demo never needs the runtime og-image backfill, which
 * is a server fetch-and-parse per visit — the exact cost the static snapshot
 * exists to remove. Best effort: an item simply ships without an image if the
 * page is unreachable or declares none.
 */
async function fetchOgImage(pageUrl) {
  if (!pageUrl) return undefined;
  try {
    const res = await fetch(pageUrl, {
      headers: { "user-agent": "AegisBot/1.0 (+https://aegis-ai.xyz)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return undefined;
    const html = (await res.text()).slice(0, 512_000);
    const meta = html.match(
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*>/i,
    );
    const content = meta?.[0].match(/content=["']([^"']+)["']/i)?.[1];
    if (!content) return undefined;
    return safeLink(new URL(content, pageUrl).toString());
  } catch {
    return undefined;
  }
}

const items = [];
const failed = [];
for (const { feedUrl, label } of FEEDS) {
  let feed;
  try {
    feed = await parser.parseURL(feedUrl);
  } catch (err) {
    // One unreachable feed must not block regenerating the snapshot from the
    // rest — the operator re-runs this script when the source comes back.
    console.warn(`${label}: SKIPPED (${err instanceof Error ? err.message : String(err)})`);
    failed.push(label);
    continue;
  }
  const picked = (feed.items || [])
    .map(item => {
      const rawContent =
        item["content:encoded"] || item.content || item.contentSnippet || item.summary || "";
      const text = `${item.title || ""}\n\n${stripHtml(String(rawContent))}`
        .slice(0, MAX_TEXT_LENGTH)
        .trim();
      return {
        text,
        author: item.creator || item.author || feed.title || label,
        sourceUrl: safeLink(item.link),
        imageUrl: extractImage(item, rawContent),
        feedUrl,
      };
    })
    // Drop title-only entries: they carry no signal for the scorer to show.
    .filter(i => i.text.length >= 200)
    .slice(0, ITEMS_PER_FEED);
  // Fill the gaps the feed itself did not provide.
  for (const item of picked) {
    if (!item.imageUrl) item.imageUrl = await fetchOgImage(item.sourceUrl);
  }
  const withImage = picked.filter(i => i.imageUrl).length;
  console.log(`${label}: ${picked.length} items (${withImage} with an image)`);
  items.push(...picked);
}

if (items.length === 0) {
  console.error("No feed produced items — refusing to overwrite the snapshot with an empty demo.");
  process.exit(1);
}

const snapshot = {
  // Bumped only on a breaking shape change; lib/demo/feed.ts refuses anything else.
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  note: "Static demo snapshot — regenerate with `node scripts/generate-demo-feed.mjs`.",
  items,
};

await fs.writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Wrote ${items.length} items to ${path.relative(root, OUT)}`);
if (failed.length > 0) {
  console.warn(`Snapshot is missing: ${failed.join(", ")} — re-run when those feeds respond.`);
}
