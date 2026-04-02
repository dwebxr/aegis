import { LANGUAGES, DEFAULT_TRANSLATION_PREFS } from "@/lib/translation/types";

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
