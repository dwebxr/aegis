import { LANGUAGES, DEFAULT_TRANSLATION_PREFS, shouldAutoTranslate } from "@/lib/translation/types";
import type { ContentItem } from "@/lib/types/content";

function makeItem(composite: number): ContentItem {
  return {
    id: "item",
    owner: "owner",
    author: "author",
    avatar: "A",
    text: "text",
    source: "rss",
    scores: { originality: composite, insight: composite, credibility: composite, composite },
    verdict: "quality",
    reason: "reason",
    createdAt: 0,
    validated: false,
    flagged: false,
    timestamp: "now",
  };
}

describe("LANGUAGES", () => {
  it("contains 10 languages", () => {
    expect(LANGUAGES).toHaveLength(10);
  });

  it("includes Japanese", () => {
    const ja = LANGUAGES.find(l => l.code === "ja");
    expect(ja).toBeDefined();
    expect(ja!.nativeLabel).toBe("日本語");
  });

  it("all entries have code, label, and nativeLabel", () => {
    for (const lang of LANGUAGES) {
      expect(lang.code).toBeTruthy();
      expect(lang.label).toBeTruthy();
      expect(lang.nativeLabel).toBeTruthy();
    }
  });

  it("has unique codes", () => {
    const codes = LANGUAGES.map(l => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("DEFAULT_TRANSLATION_PREFS", () => {
  it("defaults to English target", () => {
    expect(DEFAULT_TRANSLATION_PREFS.targetLanguage).toBe("en");
  });

  it("defaults to manual policy", () => {
    expect(DEFAULT_TRANSLATION_PREFS.policy).toBe("manual");
  });

  it("defaults to auto backend", () => {
    expect(DEFAULT_TRANSLATION_PREFS.backend).toBe("auto");
  });

  it("has a reasonable default minScore", () => {
    expect(DEFAULT_TRANSLATION_PREFS.minScore).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_TRANSLATION_PREFS.minScore).toBeLessThanOrEqual(10);
  });
});

describe("shouldAutoTranslate", () => {
  it("allows policy=all regardless of score", () => {
    expect(shouldAutoTranslate(makeItem(1), { ...DEFAULT_TRANSLATION_PREFS, policy: "all" })).toBe(true);
  });

  it("allows high_quality when composite meets minScore", () => {
    expect(shouldAutoTranslate(makeItem(7), { ...DEFAULT_TRANSLATION_PREFS, policy: "high_quality", minScore: 7 })).toBe(true);
    expect(shouldAutoTranslate(makeItem(6.9), { ...DEFAULT_TRANSLATION_PREFS, policy: "high_quality", minScore: 7 })).toBe(false);
  });

  it("rejects off and manual policies", () => {
    expect(shouldAutoTranslate(makeItem(10), { ...DEFAULT_TRANSLATION_PREFS, policy: "off" })).toBe(false);
    expect(shouldAutoTranslate(makeItem(10), { ...DEFAULT_TRANSLATION_PREFS, policy: "manual" })).toBe(false);
  });
});
