/**
 * @jest-environment jsdom
 */
import { sourcesToOpml, opmlToSources } from "@/lib/sources/opml";
import type { SavedSource } from "@/lib/types/sources";

function makeSrc(overrides: Partial<SavedSource> = {}): SavedSource {
  return {
    id: "rss:https://example.com/feed",
    type: "rss",
    label: "Example",
    feedUrl: "https://example.com/feed",
    enabled: true,
    createdAt: 1000,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  sourcesToOpml                                                      */
/* ------------------------------------------------------------------ */

describe("sourcesToOpml", () => {
  it("exports only RSS sources with feedUrl", () => {
    const sources: SavedSource[] = [
      makeSrc({ id: "rss:https://a.com/feed", feedUrl: "https://a.com/feed", label: "A" }),
      makeSrc({ id: "nostr:relay", type: "nostr", label: "Nostr", feedUrl: undefined, relays: ["wss://r.com"] }),
      makeSrc({ id: "fc:1", type: "farcaster", label: "FC", feedUrl: undefined, fid: 1 }),
    ];
    const xml = sourcesToOpml(sources);
    expect(xml).toContain("https://a.com/feed");
    expect(xml).not.toContain("Nostr");
    expect(xml).not.toContain("FC");
  });

  it("excludes RSS sources without feedUrl", () => {
    const sources = [makeSrc({ feedUrl: undefined })];
    const xml = sourcesToOpml(sources);
    expect(xml).not.toContain("<outline text=");
    expect(xml).toContain("<opml version=\"2.0\">");
    expect(xml).toContain("<body>");
  });

  it("groups by platform, defaults to General", () => {
    const sources = [
      makeSrc({ id: "rss:a", feedUrl: "https://a.com/f", platform: "youtube", label: "YT" }),
      makeSrc({ id: "rss:b", feedUrl: "https://b.com/f", platform: "youtube", label: "YT2" }),
      makeSrc({ id: "rss:c", feedUrl: "https://c.com/f", label: "Gen" }),
    ];
    const xml = sourcesToOpml(sources);
    expect(xml).toContain('text="youtube"');
    expect(xml).toContain('text="General"');
    const parsed = opmlToSources(xml);
    expect(parsed).toHaveLength(3);
  });

  it("returns valid OPML for empty array", () => {
    const xml = sourcesToOpml([]);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<opml version=\"2.0\">");
    expect(xml).toContain("<title>Aegis OPML Export</title>");
    expect(xml).toContain("<body>");
    expect(xml).toContain("</body>");
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
  });

  it("escapes special XML characters", () => {
    const sources = [
      makeSrc({ label: 'A & B <"test">', feedUrl: "https://x.com/f?a=1&b=2" }),
    ];
    const xml = sourcesToOpml(sources);
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&gt;");
    expect(xml).toContain("&quot;");
    const parsed = opmlToSources(xml);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].feedUrl).toBe("https://x.com/f?a=1&b=2");
    expect(parsed[0].label).toBe('A & B <"test">');
  });

  it("exports disabled sources", () => {
    const sources = [makeSrc({ enabled: false, id: "rss:d", feedUrl: "https://d.com/f", label: "Disabled" })];
    const xml = sourcesToOpml(sources);
    expect(xml).toContain("https://d.com/f");
    expect(xml).toContain("Disabled");
  });

  it("produces well-formed XML for all platforms", () => {
    const platforms = ["youtube", "topic", "github", "bluesky", "reddit", "mastodon", "farcaster"] as const;
    const sources = platforms.map((p, i) =>
      makeSrc({ id: `rss:${i}`, feedUrl: `https://${p}.com/f`, platform: p, label: `${p} feed` }),
    );
    const xml = sourcesToOpml(sources);
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const folders = doc.querySelectorAll("body > outline");
    expect(folders.length).toBe(7);
  });

  it("outputs correct XML structure with declaration and head", () => {
    const xml = sourcesToOpml([makeSrc()]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    expect(doc.querySelector("opml")?.getAttribute("version")).toBe("2.0");
    expect(doc.querySelector("head > title")?.textContent).toBe("Aegis OPML Export");
    const outlines = doc.querySelectorAll("body outline[xmlUrl]");
    expect(outlines.length).toBe(1);
    expect(outlines[0].getAttribute("type")).toBe("rss");
  });
});

/* ------------------------------------------------------------------ */
/*  opmlToSources                                                      */
/* ------------------------------------------------------------------ */

describe("opmlToSources", () => {
  const FEEDLY_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head><title>Feedly</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Ars Technica" title="Ars Technica" xmlUrl="https://feeds.arstechnica.com/arstechnica/index" htmlUrl="https://arstechnica.com"/>
      <outline type="rss" text="Hacker News" xmlUrl="https://news.ycombinator.com/rss"/>
    </outline>
    <outline type="rss" text="BBC News" xmlUrl="https://feeds.bbci.co.uk/news/rss.xml"/>
  </body>
</opml>`;

  it("parses standard Feedly-style OPML", () => {
    const result = opmlToSources(FEEDLY_OPML);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe("Ars Technica");
    expect(result[0].feedUrl).toBe("https://feeds.arstechnica.com/arstechnica/index");
    expect(result[0].type).toBe("rss");
    expect(result[0].id).toBe("rss:https://feeds.arstechnica.com/arstechnica/index");
    expect(result[0].enabled).toBe(true);
    expect(typeof result[0].createdAt).toBe("number");
    expect(result[0].createdAt).toBeGreaterThan(0);
  });

  const INOREADER_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head><title>Inoreader Subscriptions</title></head>
  <body>
    <outline text="Subscriptions">
      <outline text="Programming">
        <outline text="Go Blog" title="Go Blog" type="rss" xmlUrl="https://go.dev/blog/feed.atom" htmlUrl="https://go.dev/blog"/>
      </outline>
      <outline text="News">
        <outline text="Reuters" type="rss" xmlUrl="https://reuters.com/rss"/>
      </outline>
    </outline>
  </body>
</opml>`;

  it("parses nested folder structures (Inoreader-style)", () => {
    const result = opmlToSources(INOREADER_OPML);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Go Blog");
    expect(result[1].label).toBe("Reuters");
  });

  it("parses deeply nested folders (4 levels)", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="L1">
        <outline text="L2">
          <outline text="L3">
            <outline text="Deep" xmlUrl="https://deep.com/f"/>
          </outline>
        </outline>
      </outline>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Deep");
    expect(result[0].feedUrl).toBe("https://deep.com/f");
  });

  it("handles lowercase xmlurl attribute (case insensitivity)", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="Lower" xmlurl="https://lower.com/f"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(1);
    expect(result[0].feedUrl).toBe("https://lower.com/f");
  });

  it("returns empty array for invalid XML", () => {
    expect(opmlToSources("<not valid xml!!!")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(opmlToSources("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(opmlToSources("   \n\t  ")).toEqual([]);
  });

  it("returns empty array for valid XML without <body>", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/></opml>`;
    expect(opmlToSources(xml)).toEqual([]);
  });

  it("returns empty array for non-OPML XML", () => {
    const xml = `<?xml version="1.0"?><html><body><p>Not OPML</p></body></html>`;
    // Has a <body> but no <outline> children
    expect(opmlToSources(xml)).toEqual([]);
  });

  it("excludes outlines without xmlUrl", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="Folder"/>
      <outline text="NoUrl" type="rss"/>
      <outline text="HasUrl" xmlUrl="https://x.com/f"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("HasUrl");
  });

  it("excludes non-http(s) URLs", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="FTP" xmlUrl="ftp://x.com/feed"/>
      <outline text="File" xmlUrl="file:///etc/passwd"/>
      <outline text="JS" xmlUrl="javascript:alert(1)"/>
      <outline text="Data" xmlUrl="data:text/html,test"/>
      <outline text="OK" xmlUrl="https://safe.com/feed"/>
      <outline text="HTTP" xmlUrl="http://plain.com/feed"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(2);
    expect(result[0].feedUrl).toBe("https://safe.com/feed");
    expect(result[1].feedUrl).toBe("http://plain.com/feed");
  });

  it("deduplicates by feedUrl, keeping first occurrence", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="First" xmlUrl="https://x.com/feed"/>
      <outline text="Second" xmlUrl="https://x.com/feed"/>
      <outline text="Third" xmlUrl="https://x.com/feed"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("First");
  });

  it("deduplicates across nested and flat outlines", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="Folder">
        <outline text="Nested" xmlUrl="https://x.com/feed"/>
      </outline>
      <outline text="Flat" xmlUrl="https://x.com/feed"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Nested");
  });

  it("enforces 500 outline limit", () => {
    const outlines = Array.from({ length: 600 }, (_, i) =>
      `<outline text="Feed ${i}" xmlUrl="https://x.com/${i}"/>`,
    ).join("\n");
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>${outlines}</body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(500);
    expect(result[0].feedUrl).toBe("https://x.com/0");
    expect(result[499].feedUrl).toBe("https://x.com/499");
  });

  it("accepts exactly 500 outlines", () => {
    const outlines = Array.from({ length: 500 }, (_, i) =>
      `<outline text="Feed ${i}" xmlUrl="https://x.com/${i}"/>`,
    ).join("\n");
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>${outlines}</body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(500);
  });

  it("returns empty array when XML exceeds 1MB", () => {
    const padding = "x".repeat(1_048_577);
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body><!-- ${padding} --></body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toEqual([]);
  });

  it("accepts XML at exactly 1MB", () => {
    const shell = `<?xml version="1.0"?><opml version="2.0"><head/><body><outline text="OK" xmlUrl="https://ok.com/f"/><!-- `;
    const tail = ` --></body></opml>`;
    const padLen = 1_048_576 - shell.length - tail.length;
    const xml = shell + "a".repeat(padLen) + tail;
    expect(xml.length).toBe(1_048_576);
    const result = opmlToSources(xml);
    expect(result).toHaveLength(1);
  });

  it("excludes URLs longer than 2048 characters", () => {
    const longPath = "a".repeat(2040);
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="TooLong" xmlUrl="https://x.com/${longPath}"/>
      <outline text="OK" xmlUrl="https://ok.com/f"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    // "https://x.com/" is 14 chars + 2040 = 2054 > 2048
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("OK");
  });

  it("accepts URLs at exactly 2048 characters", () => {
    const prefix = "https://x.com/";
    const path = "b".repeat(2048 - prefix.length);
    const url = prefix + path;
    expect(url.length).toBe(2048);
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="Exact" xmlUrl="${url}"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(1);
    expect(result[0].feedUrl).toBe(url);
  });

  it("uses text, then title, then xmlUrl as label fallback", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="TextLabel" title="TitleLabel" xmlUrl="https://a.com/f"/>
      <outline title="OnlyTitle" xmlUrl="https://b.com/f"/>
      <outline xmlUrl="https://c.com/f"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result[0].label).toBe("TextLabel");
    expect(result[1].label).toBe("OnlyTitle");
    expect(result[2].label).toBe("https://c.com/f");
  });

  it("handles empty text attribute, falls back to title", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="" title="Fallback" xmlUrl="https://a.com/f"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result[0].label).toBe("Fallback");
  });

  it("handles Unicode content in labels", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head/><body>
      <outline text="日本語ブログ" xmlUrl="https://jp.com/feed"/>
      <outline text="Ünïcödé" xmlUrl="https://uni.com/feed"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("日本語ブログ");
    expect(result[1].label).toBe("Ünïcödé");
  });

  it("handles mixed valid and invalid outlines", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="Good1" xmlUrl="https://a.com/f"/>
      <outline text="Bad" xmlUrl="ftp://b.com/f"/>
      <outline text="Good2" xmlUrl="http://c.com/f"/>
      <outline text="NoUrl"/>
      <outline text="Good3" xmlUrl="https://d.com/f"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.label)).toEqual(["Good1", "Good2", "Good3"]);
  });

  it("generates correct id format for each source", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="A" xmlUrl="https://a.com/feed?x=1"/>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result[0].id).toBe("rss:https://a.com/feed?x=1");
  });

  it("skips non-outline elements in body", () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <comment>ignore this</comment>
      <outline text="Real" xmlUrl="https://real.com/f"/>
      <div>not an outline</div>
    </body></opml>`;
    const result = opmlToSources(xml);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Real");
  });
});

/* ------------------------------------------------------------------ */
/*  Round-trip                                                         */
/* ------------------------------------------------------------------ */

describe("round-trip", () => {
  it("preserves feedUrl and label through export then import", () => {
    const original: SavedSource[] = [
      makeSrc({ id: "rss:https://a.com/f", feedUrl: "https://a.com/f", label: "Alpha", platform: "youtube" }),
      makeSrc({ id: "rss:https://b.com/f", feedUrl: "https://b.com/f", label: "Beta" }),
    ];
    const xml = sourcesToOpml(original);
    const restored = opmlToSources(xml);

    expect(restored).toHaveLength(2);
    for (const orig of original) {
      const found = restored.find((r) => r.feedUrl === orig.feedUrl);
      expect(found).toBeDefined();
      expect(found!.label).toBe(orig.label);
      expect(found!.type).toBe("rss");
      expect(found!.enabled).toBe(true);
    }
  });

  it("preserves special characters through round-trip", () => {
    const original = [
      makeSrc({
        id: "rss:https://x.com/f?a=1&b=2",
        feedUrl: "https://x.com/f?a=1&b=2",
        label: 'News & "Updates" <Daily>',
      }),
    ];
    const xml = sourcesToOpml(original);
    const restored = opmlToSources(xml);
    expect(restored).toHaveLength(1);
    expect(restored[0].feedUrl).toBe("https://x.com/f?a=1&b=2");
    expect(restored[0].label).toBe('News & "Updates" <Daily>');
  });

  it("round-trips multiple platforms correctly", () => {
    const original: SavedSource[] = [
      makeSrc({ id: "rss:1", feedUrl: "https://yt.com/f", label: "YT", platform: "youtube" }),
      makeSrc({ id: "rss:2", feedUrl: "https://gh.com/f", label: "GH", platform: "github" }),
      makeSrc({ id: "rss:3", feedUrl: "https://gen.com/f", label: "Gen" }),
    ];
    const xml = sourcesToOpml(original);
    const restored = opmlToSources(xml);
    expect(restored).toHaveLength(3);
    const urls = restored.map((r) => r.feedUrl);
    expect(urls).toContain("https://yt.com/f");
    expect(urls).toContain("https://gh.com/f");
    expect(urls).toContain("https://gen.com/f");
  });
});
