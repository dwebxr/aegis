import { buildFeed } from "@/lib/feed/buildFeed";
import type { D2ABriefingResponse, D2ABriefingItem } from "@/lib/d2a/types";

function makeItem(overrides: Partial<D2ABriefingItem> = {}): D2ABriefingItem {
  return {
    title: "Sample Item",
    content: "A short article body that demonstrates how Aegis curates content for downstream readers.",
    source: "rss",
    sourceUrl: "https://example.com/article-1",
    scores: { originality: 8, insight: 9, credibility: 9, composite: 8.7, vSignal: 9, cContext: 8, lSlop: 1 },
    verdict: "quality",
    reason: "[claude-byok] dense and original",
    topics: ["machine-learning", "computational-biology"],
    briefingScore: 8.7,
    ...overrides,
  };
}

function makeBriefing(items: D2ABriefingItem[]): D2ABriefingResponse {
  return {
    version: "1.0",
    generatedAt: "2026-04-15T07:00:00.000Z",
    source: "aegis",
    sourceUrl: "https://aegis-ai.xyz",
    summary: { totalEvaluated: 50, totalBurned: 35, qualityRate: 70 },
    items,
    serendipityPick: null,
    meta: {
      scoringModel: "aegis-vcl-v1",
      nostrPubkey: null,
      topics: ["machine-learning", "computational-biology", "rust"],
    },
  };
}

const PRINCIPAL = "rrkah-fqaaa-aaaaa-aaaaq-cai";
const RSS_URL = `https://aegis-ai.xyz/api/feed/rss?principal=${PRINCIPAL}`;
const ATOM_URL = `https://aegis-ai.xyz/api/feed/atom?principal=${PRINCIPAL}`;

describe("buildFeed — RSS 2.0 output", () => {
  it("renders a valid RSS 2.0 envelope", () => {
    const feed = buildFeed({ briefing: makeBriefing([makeItem()]), principal: PRINCIPAL, rssSelfUrl: RSS_URL, atomSelfUrl: ATOM_URL });
    const xml = feed.rss2();
    expect(xml).toContain("<?xml");
    expect(xml).toMatch(/<rss[^>]*version="2\.0"/);
    expect(xml).toContain("<channel>");
    expect(xml).toContain("<title>");
  });

  it("includes the principal in the title and channel id", () => {
    const feed = buildFeed({ briefing: makeBriefing([makeItem()]), principal: PRINCIPAL, rssSelfUrl: RSS_URL, atomSelfUrl: ATOM_URL });
    const xml = feed.rss2();
    expect(xml).toContain(PRINCIPAL.slice(0, 8));
  });

  it("emits one <item> per briefing item with title, link, description", () => {
    const items = [makeItem({ title: "Item One", sourceUrl: "https://example.com/1" }), makeItem({ title: "Item Two", sourceUrl: "https://example.com/2" })];
    const feed = buildFeed({ briefing: makeBriefing(items), principal: PRINCIPAL, rssSelfUrl: RSS_URL, atomSelfUrl: ATOM_URL });
    const xml = feed.rss2();
    expect(xml).toContain("<title><![CDATA[Item One]]></title>");
    expect(xml).toContain("<title><![CDATA[Item Two]]></title>");
    expect(xml).toContain("https://example.com/1");
    expect(xml).toContain("https://example.com/2");
  });

  it("prefixes description with score sigil", () => {
    const feed = buildFeed({ briefing: makeBriefing([makeItem({ scores: { originality: 8, insight: 9, credibility: 9, composite: 8.7 } })]), principal: PRINCIPAL, rssSelfUrl: RSS_URL, atomSelfUrl: ATOM_URL });
    const xml = feed.rss2();
    expect(xml).toContain("[score 8.7]");
  });

  it("emits a category per topic", () => {
    const feed = buildFeed({ briefing: makeBriefing([makeItem({ topics: ["alpha", "beta"] })]), principal: PRINCIPAL, rssSelfUrl: RSS_URL, atomSelfUrl: ATOM_URL });
    const xml = feed.rss2();
    expect(xml).toContain("alpha");
    expect(xml).toContain("beta");
  });

  it("falls back to APP_URL link when sourceUrl is empty", () => {
    const feed = buildFeed({ briefing: makeBriefing([makeItem({ sourceUrl: "" })]), principal: PRINCIPAL, rssSelfUrl: RSS_URL, atomSelfUrl: ATOM_URL });
    const xml = feed.rss2();
    expect(xml).toMatch(/<link>https?:\/\//);
  });

  it("truncates content beyond 600 chars in description with ellipsis", () => {
    const long = "x".repeat(2000);
    const feed = buildFeed({ briefing: makeBriefing([makeItem({ content: long })]), principal: PRINCIPAL, rssSelfUrl: RSS_URL, atomSelfUrl: ATOM_URL });
    const xml = feed.rss2();
    // Description (truncated) and content (full) both present.
    expect(xml).toContain("…");
  });

  it("truncation does not split a UTF-16 surrogate pair (emoji safety)", () => {
    // 600 'x' chars then a single 4-byte emoji at exactly position 600. A
    // naive .slice(0, 600) would land mid-content; .slice(0, 601) would split
    // the emoji's surrogate pair and produce an invalid Unicode string.
    // We verify the output description never contains a lone surrogate.
    const text = "x".repeat(599) + "🚀" + "tail";
    const feed = buildFeed({ briefing: makeBriefing([makeItem({ content: text })]), principal: PRINCIPAL, rssSelfUrl: RSS_URL, atomSelfUrl: ATOM_URL });
    const xml = feed.rss2();
    // Lone high-surrogate (0xD800-0xDBFF) without a paired low-surrogate.
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(xml).not.toMatch(loneSurrogate);
  });
});

describe("buildFeed — Atom 1.0 output", () => {
  it("renders a valid Atom 1.0 feed", () => {
    const feed = buildFeed({ briefing: makeBriefing([makeItem()]), principal: PRINCIPAL, rssSelfUrl: RSS_URL, atomSelfUrl: ATOM_URL });
    const xml = feed.atom1();
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
    expect(xml).toContain("<entry>");
    expect(xml).toContain('<id>urn:aegis:briefing:');
  });
});

describe("buildFeed — empty briefing", () => {
  it("renders an empty channel without error", () => {
    const feed = buildFeed({ briefing: makeBriefing([]), principal: PRINCIPAL, rssSelfUrl: RSS_URL, atomSelfUrl: ATOM_URL });
    const xml = feed.rss2();
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });
});
