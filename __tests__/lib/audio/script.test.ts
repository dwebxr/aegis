import { buildTracks } from "@/lib/audio/script";
import { DEFAULT_AUDIO_PREFS } from "@/lib/audio/types";
import type { TrackSource } from "@/lib/audio/types";
import type { ContentItem } from "@/lib/types/content";
import type { TranslationResult } from "@/lib/translation/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    owner: "owner",
    author: "Test Author",
    avatar: "🤖",
    text: "Test article body. This is the second sentence.",
    source: "manual",
    sourceUrl: undefined,
    imageUrl: undefined,
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "test",
    createdAt: 0,
    validated: false,
    flagged: false,
    timestamp: "now",
    topics: [],
    ...overrides,
  };
}

describe("buildTracks", () => {
  it("returns empty array for empty input", () => {
    expect(buildTracks([], DEFAULT_AUDIO_PREFS)).toEqual([]);
  });

  it("builds a single track from a basic item", () => {
    const sources: TrackSource[] = [{ item: makeItem(), isSerendipity: false }];
    const tracks = buildTracks(sources, DEFAULT_AUDIO_PREFS);
    expect(tracks).toHaveLength(1);
    const track = tracks[0];
    expect(track.id).toBe("item-1");
    expect(track.author).toBe("Test Author");
    expect(track.lang).toBe("en");
    expect(track.chunks.length).toBeGreaterThan(0);
    expect(track.chunks.join(" ")).toContain("Test article body");
    expect(track.totalChars).toBe(track.chunks.reduce((n, c) => n + c.length, 0));
    expect(track.isSerendipity).toBe(false);
  });

  it("preserves serendipity flag", () => {
    const sources: TrackSource[] = [{ item: makeItem(), isSerendipity: true }];
    const tracks = buildTracks(sources, DEFAULT_AUDIO_PREFS);
    expect(tracks[0].isSerendipity).toBe(true);
  });

  it("detects Japanese from kana in original text", () => {
    const item = makeItem({
      id: "ja-1",
      text: "これは日本語のテスト記事です。重要な情報を含んでいます。",
    });
    const tracks = buildTracks([{ item, isSerendipity: false }], DEFAULT_AUDIO_PREFS);
    expect(tracks[0].lang).toBe("ja");
  });

  it("uses translation when preferTranslated is true and translation exists", () => {
    const translation: TranslationResult = {
      translatedText: "翻訳されたテキストです。これは二番目の文章です。",
      targetLanguage: "ja",
      backend: "ic-llm",
      generatedAt: 0,
    };
    const item = makeItem({ translation });
    const tracks = buildTracks(
      [{ item, isSerendipity: false }],
      { ...DEFAULT_AUDIO_PREFS, preferTranslated: true },
    );
    expect(tracks[0].lang).toBe("ja");
    expect(tracks[0].chunks.join(" ")).toContain("翻訳された");
  });

  it("ignores translation when preferTranslated is false", () => {
    const translation: TranslationResult = {
      translatedText: "翻訳されたテキスト",
      targetLanguage: "ja",
      backend: "ic-llm",
      generatedAt: 0,
    };
    const item = makeItem({ translation });
    const tracks = buildTracks(
      [{ item, isSerendipity: false }],
      { ...DEFAULT_AUDIO_PREFS, preferTranslated: false },
    );
    expect(tracks[0].lang).toBe("en");
    expect(tracks[0].chunks.join(" ")).toContain("Test article body");
  });

  it("truncates long body text", () => {
    const longBody = "First line\n" + "x".repeat(2000);
    const tracks = buildTracks(
      [{ item: makeItem({ text: longBody }), isSerendipity: false }],
      DEFAULT_AUDIO_PREFS,
    );
    expect(tracks[0].totalChars).toBeLessThan(longBody.length);
    expect(tracks[0].totalChars).toBeLessThanOrEqual(150 + 500 + 20);
  });

  it("filters out tracks with no spoken content", () => {
    const empty = makeItem({ text: "" });
    const valid = makeItem({ id: "valid", text: "Real content here." });
    const tracks = buildTracks(
      [
        { item: empty, isSerendipity: false },
        { item: valid, isSerendipity: false },
      ],
      DEFAULT_AUDIO_PREFS,
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe("valid");
  });

  it("uses first line as title and rest as body", () => {
    const item = makeItem({
      text: "Article title here\n\nBody paragraph one.\nBody paragraph two.",
    });
    const tracks = buildTracks([{ item, isSerendipity: false }], DEFAULT_AUDIO_PREFS);
    expect(tracks[0].title).toBe("Article title here");
    const joined = tracks[0].chunks.join(" ");
    expect(joined).toContain("Article title here");
    expect(joined).toContain("Body paragraph one");
  });

  it("respects explicit lang override", () => {
    const tracks = buildTracks(
      [{ item: makeItem(), isSerendipity: false, lang: "ja" }],
      DEFAULT_AUDIO_PREFS,
    );
    expect(tracks[0].lang).toBe("ja");
  });
});
